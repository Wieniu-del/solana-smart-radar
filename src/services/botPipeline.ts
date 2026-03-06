/**
 * Bot Trading Pipeline
 * Token Detection → Security Scan → Liquidity Check → Wallet Analysis → Scoring → Execution → Risk Management
 */

import { analyzeWallet, getTokenBalances, type WalletAnalysis, type HeliusTokenBalance, type ParsedTrade } from "./helius";
import { analyzeTokenSecurity, analyzeAllTokens, type TokenSecurityReport } from "./tokenSecurity";
import { calculateSmartScore, type SmartScoreBreakdown } from "./walletScoring";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const BASE_ASSET_MINTS = new Set<string>([
  SOL_MINT,
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

function normalizeTokenLabel(value?: string | null): string {
  const label = (value || "").trim();
  return label && label !== "???" ? label : "";
}

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function shouldConsiderBuyCandidate(trade: ParsedTrade): boolean {
  if (!trade.tokenOut?.mint) return false;
  const outMint = trade.tokenOut.mint;
  if (BASE_ASSET_MINTS.has(outMint)) return false;

  if (trade.type === "BUY") return true;

  if (trade.type === "SWAP" && trade.tokenIn?.mint) {
    return BASE_ASSET_MINTS.has(trade.tokenIn.mint);
  }

  return false;
}

// ─── Pipeline Types ───

export interface TokenCandidate {
  mint: string;
  symbol: string;
  name: string;
  source: "smart_wallet" | "new_pair" | "whale_buy";
  sourceWallet?: string;
  detectedAt: number;
}

export interface PipelineResult {
  token: TokenCandidate;
  securityScore: number;
  securityReport: TokenSecurityReport | null;
  liquidityScore: number;
  liquidityData: LiquidityData;
  walletScore: number;
  walletData: WalletActivityData;
  totalScore: number;
  decision: "BUY" | "SKIP" | "WATCH";
  reasons: string[];
  timestamp: number;
}

export interface LiquidityData {
  estimatedLiquidityUsd: number;
  hasPrice: boolean;
  priceUsd: number;
  holderCount: number;
  volumeProxy: number;
}

export interface WalletActivityData {
  smartWalletsBuying: number;
  newWalletsBuying: number;
  whaleWalletsBuying: number;
  totalBuyers: number;
  avgBuyerScore: number;
}

export interface RiskManagerConfig {
  stopLossPct: number;
  takeProfitPct: number;
  trailingStopPct: number;
  useTrailingStop: boolean;
  maxPositionSol: number;
}

export interface ActivePosition {
  tokenMint: string;
  tokenSymbol: string;
  entryPriceUsd: number;
  currentPriceUsd: number;
  highestPriceUsd: number;
  amountSol: number;
  entryTime: number;
  trailingStopLevel: number | null;
  stopLossLevel: number;
  takeProfitLevel: number;
  status: "active" | "stopped" | "profit_taken" | "trailing_stopped";
}

// ─── 1. Token Detection ───

export function detectTokensFromWallet(analysis: WalletAnalysis): TokenCandidate[] {
  const candidates: TokenCandidate[] = [];
  const oneDayAgo = Date.now() / 1000 - 86400;

  const recentTrades = analysis.trades.filter((t) => t.timestamp > oneDayAgo);

  for (const trade of recentTrades) {
    if (!shouldConsiderBuyCandidate(trade) || !trade.tokenOut) continue;

    const symbol = normalizeTokenLabel(trade.tokenOut.symbol);

    candidates.push({
      mint: trade.tokenOut.mint,
      symbol: symbol || shortMint(trade.tokenOut.mint),
      name: symbol || shortMint(trade.tokenOut.mint),
      source: "smart_wallet",
      sourceWallet: analysis.address,
      detectedAt: trade.timestamp,
    });
  }

  return candidates;
}

export function detectWhaleTokens(analysis: WalletAnalysis): TokenCandidate[] {
  if (analysis.totalValueUsd < 100000) return [];

  const candidates: TokenCandidate[] = [];
  const oneDayAgo = Date.now() / 1000 - 86400;

  const recentTrades = analysis.trades.filter((t) => t.timestamp > oneDayAgo);

  for (const trade of recentTrades) {
    if (!shouldConsiderBuyCandidate(trade) || !trade.tokenOut) continue;

    const symbol = normalizeTokenLabel(trade.tokenOut.symbol);

    candidates.push({
      mint: trade.tokenOut.mint,
      symbol: symbol || shortMint(trade.tokenOut.mint),
      name: symbol || shortMint(trade.tokenOut.mint),
      source: "whale_buy",
      sourceWallet: analysis.address,
      detectedAt: trade.timestamp,
    });
  }

  return candidates;
}

// ─── 2. Security Scanner ───

export function runSecurityScan(token: HeliusTokenBalance): { passed: boolean; score: number; report: TokenSecurityReport } {
  const report = analyzeTokenSecurity(token);

  // Token passes security if risk score < 40
  const passed = report.riskScore < 40;
  // Invert risk to get safety score (0-100, higher = safer)
  const score = Math.max(0, 100 - report.riskScore);

  return { passed, score, report };
}

// ─── 3. Liquidity Scanner ───

export function analyzeLiquidity(token: HeliusTokenBalance): { passed: boolean; score: number; data: LiquidityData } {
  const data: LiquidityData = {
    estimatedLiquidityUsd: token.valueUsd || 0,
    hasPrice: (token.priceUsd || 0) > 0,
    priceUsd: token.priceUsd || 0,
    holderCount: 0, // Would need on-chain data
    volumeProxy: token.amount * (token.priceUsd || 0),
  };

  let score = 0;

  // Has price = basic liquidity exists
  if (data.hasPrice) score += 30;

  // Value thresholds
  if (data.estimatedLiquidityUsd > 100000) score += 30;
  else if (data.estimatedLiquidityUsd > 10000) score += 20;
  else if (data.estimatedLiquidityUsd > 1000) score += 10;

  // Price not micro (dust attack protection)
  if (data.priceUsd > 0.0001) score += 20;
  else if (data.priceUsd > 0.00000001) score += 10;

  // Volume proxy
  if (data.volumeProxy > 50000) score += 20;
  else if (data.volumeProxy > 5000) score += 10;

  const passed = score >= 40 && data.hasPrice;

  return { passed, score: Math.min(score, 100), data };
}

// ─── 4. Wallet Activity Analyzer ───

export function analyzeWalletActivity(
  analyses: WalletAnalysis[],
  tokenMint: string
): { score: number; data: WalletActivityData } {
  let smartWalletsBuying = 0;
  let whaleWalletsBuying = 0;
  let totalBuyers = 0;
  let scoreSum = 0;

  const oneDayAgo = Date.now() / 1000 - 86400;

  for (const analysis of analyses) {
    const walletScore = calculateSmartScore(analysis);
    const boughtToken = analysis.trades.some(
      (t) => t.type === "BUY" && t.timestamp > oneDayAgo && t.tokenOut?.mint === tokenMint
    );

    if (boughtToken) {
      totalBuyers++;
      scoreSum += walletScore.total;

      if (walletScore.total >= 60) smartWalletsBuying++;
      if (analysis.totalValueUsd >= 100000) whaleWalletsBuying++;
    }
  }

  const avgBuyerScore = totalBuyers > 0 ? scoreSum / totalBuyers : 0;

  let score = 0;
  score += Math.min(smartWalletsBuying * 15, 40);
  score += Math.min(whaleWalletsBuying * 20, 30);
  score += avgBuyerScore > 60 ? 20 : avgBuyerScore > 40 ? 10 : 0;
  score += totalBuyers >= 3 ? 10 : totalBuyers >= 1 ? 5 : 0;

  return {
    score: Math.min(score, 100),
    data: {
      smartWalletsBuying,
      newWalletsBuying: totalBuyers - smartWalletsBuying,
      whaleWalletsBuying,
      totalBuyers,
      avgBuyerScore,
    },
  };
}

// ─── 5. Scoring Engine ───

export function calculateBotScore(
  securityScore: number,
  liquidityScore: number,
  walletActivityScore: number
): { total: number; decision: "BUY" | "SKIP" | "WATCH"; reasons: string[] } {
  const reasons: string[] = [];

  // Weighted scoring — bezpieczeństwo i płynność mają priorytet
  const secWeight = 0.35;
  const liqWeight = 0.30;
  const walWeight = 0.35;

  const total = Math.round(
    securityScore * secWeight +
    liquidityScore * liqWeight +
    walletActivityScore * walWeight
  );

  // Build reasons
  if (securityScore >= 70) reasons.push(`✅ Bezpieczeństwo: ${securityScore}/100`);
  else if (securityScore >= 40) reasons.push(`⚠️ Bezpieczeństwo: ${securityScore}/100`);
  else reasons.push(`❌ Bezpieczeństwo: ${securityScore}/100 — zbyt ryzykowny`);

  if (liquidityScore >= 60) reasons.push(`✅ Płynność: ${liquidityScore}/100`);
  else if (liquidityScore >= 30) reasons.push(`⚠️ Płynność: ${liquidityScore}/100`);
  else reasons.push(`❌ Płynność: ${liquidityScore}/100 — za niska`);

  if (walletActivityScore >= 50) reasons.push(`✅ Smart Money: ${walletActivityScore}/100`);
  else reasons.push(`⚠️ Smart Money: ${walletActivityScore}/100`);

  // Decision
  let decision: "BUY" | "SKIP" | "WATCH";
  if (total >= 65 && securityScore >= 55 && liquidityScore >= 40) {
    decision = "BUY";
    reasons.push(`🟢 DECYZJA: KUP (score ${total}/100)`);
  } else if (total >= 40 && securityScore >= 30) {
    decision = "WATCH";
    reasons.push(`🟡 DECYZJA: OBSERWUJ (score ${total}/100)`);
  } else {
    decision = "SKIP";
    reasons.push(`🔴 DECYZJA: POMIŃ (score ${total}/100)`);
  }

  return { total, decision, reasons };
}

// ─── 6. Full Pipeline Runner ───

export async function runPipeline(
  trackedWallets: string[]
): Promise<PipelineResult[]> {
  const results: PipelineResult[] = [];

  if (trackedWallets.length === 0) return results;

  // Step 1: Analyze all tracked wallets
  const analyses: WalletAnalysis[] = [];
  for (const wallet of trackedWallets) {
    try {
      const analysis = await analyzeWallet(wallet);
      analyses.push(analysis);
    } catch (e) {
      console.warn(`Pipeline: skip wallet ${wallet}:`, e);
    }
  }

  // Step 2: Detect candidate tokens from all wallets
  const allCandidates: TokenCandidate[] = [];
  const seenMints = new Set<string>();

  for (const analysis of analyses) {
    const fromSmart = detectTokensFromWallet(analysis);
    const fromWhale = detectWhaleTokens(analysis);

    for (const c of [...fromSmart, ...fromWhale]) {
      if (!seenMints.has(c.mint)) {
        seenMints.add(c.mint);
        allCandidates.push(c);
      }
    }
  }

  // Step 3: Run each candidate through the pipeline
  for (const candidate of allCandidates) {
    // Find token data from any wallet that holds it
    let tokenData: HeliusTokenBalance | null = null;
    for (const analysis of analyses) {
      const found = analysis.tokens.find((t) => t.mint === candidate.mint);
      if (found) { tokenData = found; break; }
    }

    if (!tokenData) {
      // Create minimal token data
      tokenData = {
        mint: candidate.mint,
        amount: 0,
        decimals: 9,
        tokenAccount: candidate.mint,
        symbol: candidate.symbol,
        name: candidate.name,
      };
    }

    const resolvedSymbol = normalizeTokenLabel(tokenData.symbol) || normalizeTokenLabel(candidate.symbol) || shortMint(candidate.mint);
    const resolvedName = normalizeTokenLabel(tokenData.name) || normalizeTokenLabel(candidate.name) || resolvedSymbol;
    candidate.symbol = resolvedSymbol;
    candidate.name = resolvedName;

    // Security scan
    const security = runSecurityScan(tokenData);

    // Liquidity scan
    const liquidity = analyzeLiquidity(tokenData);

    // Wallet activity analysis
    const walletActivity = analyzeWalletActivity(analyses, candidate.mint);

    // Scoring
    const scoring = calculateBotScore(security.score, liquidity.score, walletActivity.score);

    results.push({
      token: candidate,
      securityScore: security.score,
      securityReport: security.report,
      liquidityScore: liquidity.score,
      liquidityData: liquidity.data,
      walletScore: walletActivity.score,
      walletData: walletActivity.data,
      totalScore: scoring.total,
      decision: scoring.decision,
      reasons: scoring.reasons,
      timestamp: Date.now(),
    });
  }

  // Sort by total score descending
  results.sort((a, b) => b.totalScore - a.totalScore);

  return results;
}

// ─── 7. Risk Manager ───

export function checkRiskLevels(
  position: ActivePosition,
  config: RiskManagerConfig
): { action: "HOLD" | "SELL"; reason: string } {
  const { currentPriceUsd, entryPriceUsd, highestPriceUsd } = position;
  const changePct = ((currentPriceUsd - entryPriceUsd) / entryPriceUsd) * 100;
  const drawdownFromHigh = ((highestPriceUsd - currentPriceUsd) / highestPriceUsd) * 100;

  // Stop Loss
  if (changePct <= -config.stopLossPct) {
    return { action: "SELL", reason: `Stop Loss: spadek ${changePct.toFixed(1)}% (limit: -${config.stopLossPct}%)` };
  }

  // Take Profit
  if (changePct >= config.takeProfitPct) {
    return { action: "SELL", reason: `Take Profit: wzrost ${changePct.toFixed(1)}% (target: +${config.takeProfitPct}%)` };
  }

  // Trailing Stop
  if (config.useTrailingStop && config.trailingStopPct > 0) {
    if (drawdownFromHigh >= config.trailingStopPct && changePct > 0) {
      return {
        action: "SELL",
        reason: `Trailing Stop: spadek ${drawdownFromHigh.toFixed(1)}% od szczytu $${highestPriceUsd.toFixed(6)} (trail: ${config.trailingStopPct}%)`,
      };
    }
  }

  return { action: "HOLD", reason: `Trzymaj: zmiana ${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%` };
}

// ─── 8. Save Pipeline Results as Signals ───

export async function savePipelineSignals(results: PipelineResult[]) {
  const buyResults = results.filter((r) => r.decision === "BUY" && r.token.mint !== SOL_MINT);
  if (buyResults.length === 0) return;

  const signals = buyResults.map((r) => {
    const fallbackLabel = shortMint(r.token.mint);
    const tokenSymbol = normalizeTokenLabel(r.token.symbol) || fallbackLabel;
    const tokenName = normalizeTokenLabel(r.token.name) || tokenSymbol;

    return {
      wallet_address: r.token.sourceWallet || "pipeline",
      token_mint: r.token.mint,
      token_symbol: tokenSymbol,
      token_name: tokenName,
      signal_type: "BUY",
      strategy: `Bot Pipeline (${r.token.source})`,
      smart_score: r.walletScore,
      risk_score: 100 - r.securityScore,
      confidence: r.totalScore,
      conditions: {
        security_score: r.securityScore,
        liquidity_score: r.liquidityScore,
        wallet_score: r.walletScore,
        total_score: r.totalScore,
        reasons: r.reasons,
        source: r.token.source,
        smart_wallets_buying: r.walletData.smartWalletsBuying,
        whale_wallets_buying: r.walletData.whaleWalletsBuying,
      } as unknown as Json,
      status: "pending",
    };
  });

  const { error } = await supabase.from("trading_signals").insert(signals);
  if (error) console.error("Error saving pipeline signals:", error);
}
