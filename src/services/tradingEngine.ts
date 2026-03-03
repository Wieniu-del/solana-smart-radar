// Trading Strategy Engine — generates BUY/SELL signals based on wallet analysis
import { WalletAnalysis, ParsedTrade } from "./helius";
import { analyzeAllTokens, TokenSecurityReport } from "./tokenSecurity";
import { calculateSmartScore, SmartScoreBreakdown } from "./walletScoring";
import { supabase } from "@/integrations/supabase/client";

export interface TradingSignal {
  wallet_address: string;
  token_mint: string;
  token_symbol: string;
  token_name: string;
  signal_type: "BUY" | "SELL";
  strategy: string;
  smart_score: number;
  risk_score: number;
  confidence: number;
  conditions: Record<string, unknown>;
}

export interface StrategyConfig {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  signal_type: string;
  conditions: Record<string, unknown>;
  max_position_sol: number;
  stop_loss_pct: number | null;
  take_profit_pct: number | null;
}

// ─── Fetch strategies from DB ───
export async function getStrategies(): Promise<StrategyConfig[]> {
  const { data, error } = await supabase
    .from("trading_strategies")
    .select("*")
    .order("created_at");
  if (error) throw error;
  return (data || []).map((s) => ({
    ...s,
    conditions: (s.conditions as Record<string, unknown>) || {},
  }));
}

export async function toggleStrategy(id: string, enabled: boolean) {
  const { error } = await supabase
    .from("trading_strategies")
    .update({ enabled })
    .eq("id", id);
  if (error) throw error;
}

// ─── Signal Generation Engine ───
export function generateSignals(
  analysis: WalletAnalysis,
  strategies: StrategyConfig[],
  securityReports: TokenSecurityReport[]
): TradingSignal[] {
  const signals: TradingSignal[] = [];
  const score = calculateSmartScore(analysis);
  const enabledStrategies = strategies.filter((s) => s.enabled);

  for (const strategy of enabledStrategies) {
    const cond = strategy.conditions;

    if (strategy.signal_type === "BUY") {
      signals.push(...generateBuySignals(analysis, strategy, cond, score, securityReports));
    } else if (strategy.signal_type === "SELL") {
      signals.push(...generateSellSignals(analysis, strategy, cond, score, securityReports));
    }
  }

  return signals.sort((a, b) => b.confidence - a.confidence);
}

function generateBuySignals(
  analysis: WalletAnalysis,
  strategy: StrategyConfig,
  cond: Record<string, unknown>,
  score: SmartScoreBreakdown,
  securityReports: TokenSecurityReport[]
): TradingSignal[] {
  const signals: TradingSignal[] = [];
  const minScore = (cond.min_smart_score as number) || 0;
  const minLiquidity = (cond.min_liquidity_usd as number) || 0;
  const maxRisk = (cond.max_risk_score as number) || 100;
  const minPortfolio = (cond.min_portfolio_usd as number) || 0;

  // Check wallet qualifies
  if (score.total < minScore) return signals;
  if (analysis.totalValueUsd < minPortfolio) return signals;

  // Find recent buys in last 24h
  const oneDayAgo = Date.now() / 1000 - 86400;
  const recentBuys = analysis.trades.filter(
    (t) => t.type === "BUY" && t.timestamp > oneDayAgo && t.tokenOut
  );

  for (const trade of recentBuys) {
    if (!trade.tokenOut) continue;

    const secReport = securityReports.find((r) => r.mint === trade.tokenOut!.mint);
    const riskScore = secReport?.riskScore || 50;

    if (riskScore > maxRisk) continue;

    // Check if token has enough value (proxy for liquidity)
    const tokenHolding = analysis.tokens.find((t) => t.mint === trade.tokenOut!.mint);
    const valueUsd = tokenHolding?.valueUsd || 0;
    if (valueUsd < minLiquidity && minLiquidity > 0) continue;

    // Calculate confidence
    let confidence = 0;
    confidence += Math.min(score.total / 100, 1) * 40; // Smart score weight
    confidence += Math.max(0, (100 - riskScore) / 100) * 30; // Safety weight
    confidence += Math.min(analysis.tx24h / 20, 1) * 15; // Activity weight
    confidence += valueUsd > 1000 ? 15 : valueUsd > 100 ? 10 : 5; // Value weight

    signals.push({
      wallet_address: analysis.address,
      token_mint: trade.tokenOut.mint,
      token_symbol: trade.tokenOut.symbol,
      token_name: secReport?.name || trade.tokenOut.symbol,
      signal_type: "BUY",
      strategy: strategy.name,
      smart_score: score.total,
      risk_score: riskScore,
      confidence: Math.round(Math.min(confidence, 100)),
      conditions: {
        wallet_score: score.total,
        token_risk: riskScore,
        token_value_usd: valueUsd,
        trade_signature: trade.signature,
      },
    });
  }

  return signals;
}

function generateSellSignals(
  analysis: WalletAnalysis,
  strategy: StrategyConfig,
  cond: Record<string, unknown>,
  score: SmartScoreBreakdown,
  securityReports: TokenSecurityReport[]
): TradingSignal[] {
  const signals: TradingSignal[] = [];
  const minRisk = (cond.min_risk_score as number) || 60;
  const minScore = (cond.min_smart_score as number) || 0;
  const sellThreshold = (cond.sell_threshold_pct as number) || 50;

  // Strategy: Exit on high risk tokens
  for (const report of securityReports) {
    if (report.riskScore >= minRisk) {
      const holding = analysis.tokens.find((t) => t.mint === report.mint);
      if (!holding || (holding.valueUsd || 0) < 0.01) continue;

      let confidence = 0;
      confidence += Math.min(report.riskScore / 100, 1) * 50;
      confidence += report.flags.filter((f) => f.type === "danger").length * 15;
      confidence += report.riskLevel === "critical" ? 20 : 10;

      signals.push({
        wallet_address: analysis.address,
        token_mint: report.mint,
        token_symbol: report.symbol,
        token_name: report.name,
        signal_type: "SELL",
        strategy: strategy.name,
        smart_score: score.total,
        risk_score: report.riskScore,
        confidence: Math.round(Math.min(confidence, 100)),
        conditions: {
          risk_level: report.riskLevel,
          risk_flags: report.flags.length,
          holding_value_usd: holding.valueUsd,
        },
      });
    }
  }

  // Strategy: Smart wallet exit detection
  if (score.total >= minScore) {
    const oneDayAgo = Date.now() / 1000 - 86400;
    const recentSells = analysis.trades.filter(
      (t) => t.type === "SELL" && t.timestamp > oneDayAgo && t.tokenIn
    );

    for (const trade of recentSells) {
      if (!trade.tokenIn) continue;
      const secReport = securityReports.find((r) => r.mint === trade.tokenIn!.mint);

      signals.push({
        wallet_address: analysis.address,
        token_mint: trade.tokenIn.mint,
        token_symbol: trade.tokenIn.symbol,
        token_name: secReport?.name || trade.tokenIn.symbol,
        signal_type: "SELL",
        strategy: strategy.name,
        smart_score: score.total,
        risk_score: secReport?.riskScore || 0,
        confidence: Math.round(Math.min(score.total * 0.6 + 20, 100)),
        conditions: {
          wallet_score: score.total,
          trade_signature: trade.signature,
          exit_type: "smart_money_sell",
        },
      });
    }
  }

  return signals;
}

// ─── Save signals to DB ───
export async function saveSignals(signals: TradingSignal[]) {
  if (signals.length === 0) return;
  const { error } = await supabase.from("trading_signals").insert(
    signals.map((s) => ({
      wallet_address: s.wallet_address,
      token_mint: s.token_mint,
      token_symbol: s.token_symbol,
      token_name: s.token_name,
      signal_type: s.signal_type,
      strategy: s.strategy,
      smart_score: s.smart_score,
      risk_score: s.risk_score,
      confidence: s.confidence,
      conditions: s.conditions as unknown as import("@/integrations/supabase/types").Json,
      status: "pending" as const,
    }))
  );
  if (error) throw error;
}

// ─── Get recent signals from DB ───
export async function getRecentSignals(limit = 50) {
  const { data, error } = await supabase
    .from("trading_signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ─── Update signal status ───
export async function updateSignalStatus(
  id: string,
  status: "approved" | "rejected" | "executed" | "expired"
) {
  const update: Record<string, unknown> = { status };
  if (status === "executed") update.executed_at = new Date().toISOString();
  const { error } = await supabase
    .from("trading_signals")
    .update(update)
    .eq("id", id);
  if (error) throw error;
}
