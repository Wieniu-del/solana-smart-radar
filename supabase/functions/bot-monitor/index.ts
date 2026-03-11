import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HELIUS_BASE = "https://api.helius.xyz/v0";
const HELIUS_RPC = "https://mainnet.helius-rpc.com";

// Base assets (never BUY these)
const BASE_ASSET_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

// Known safer tokens (used only for safety scoring)
const KNOWN_SAFE_MINTS = new Set([
  ...BASE_ASSET_MINTS,
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const heliusKey = Deno.env.get("HELIUS_API_KEY");

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Create run record
  const { data: run } = await supabase
    .from("bot_runs")
    .insert({ status: "running" })
    .select("id")
    .single();

  const runId = run?.id;

  try {
    if (!heliusKey) {
      throw new Error("HELIUS_API_KEY not configured");
    }

    // 1. Check if bot is enabled
    const { data: enabledConfig } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "bot_enabled")
      .single();

    if (!enabledConfig || enabledConfig.value !== true) {
      await updateRun(supabase, runId, {
        status: "skipped",
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        details: { reason: "Bot disabled" },
      });
      return jsonResponse({ success: true, status: "skipped", reason: "Bot disabled" });
    }

    // 2. Get tracked wallets
    const { data: walletsConfig } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "tracked_wallets")
      .single();

    const wallets: string[] = (walletsConfig?.value as string[]) || [];
    if (wallets.length === 0) {
      await updateRun(supabase, runId, {
        status: "completed",
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        details: { reason: "No tracked wallets" },
      });
      return jsonResponse({ success: true, status: "no_wallets" });
    }

    // 3. Get scoring threshold
    const { data: thresholdConfig } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "min_score_threshold")
      .single();
    const minScoreThreshold = (thresholdConfig?.value as number) || 70;

    // 3b. Dynamic sizing table (score-based)
    const dynamicSizing = {
      enabled: true,
      table: [
        { minScore: 85, sol: 0.15 },
        { minScore: 75, sol: 0.10 },
        { minScore: 65, sol: 0.07 },
        { minScore: 55, sol: 0.03 },
      ],
    };

    // 3c. Get pipeline config (user-adjustable feature toggles)
    const { data: pipelineConfigData } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "pipeline_config")
      .single();
    const pipelineConfig = (pipelineConfigData?.value as any) || {};
    const pSecurity = pipelineConfig.security_check ?? { enabled: true, min_score: 30 };
    const pLiquidity = pipelineConfig.liquidity_check ?? { enabled: true, min_value_usd: 30000 };
    const pWallet = pipelineConfig.wallet_analysis ?? { enabled: true, min_wallet_value_usd: 50 };
    const pScoring = pipelineConfig.scoring ?? { buy_threshold: 60, watch_threshold: 40 };
    const pCorrelation = pipelineConfig.correlation ?? { enabled: true, min_wallets: 2, bonus_per_wallet: 10, max_bonus: 20 };
    const pSentiment = pipelineConfig.sentiment ?? { enabled: true, block_on_avoid: true };

    // Load enabled technical analysis strategies
    const { data: taConfig } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "technical_strategies")
      .maybeSingle();
    const enabledTAStrategies: string[] = Array.isArray(taConfig?.value) ? (taConfig.value as string[]) : [];
    if (enabledTAStrategies.length > 0) {
      console.log(`[bot] TA strategies enabled: ${enabledTAStrategies.join(", ")}`);
    }

    // Lookback window for wallet activity (default 72h to avoid empty scans)
    const { data: lookbackConfig } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "lookback_hours")
      .single();
    const lookbackHours = Math.max(6, Math.min(168, Number(lookbackConfig?.value || 72)));
    const lookbackSinceTs = Date.now() / 1000 - lookbackHours * 3600;

    // Use pipeline scoring thresholds if set, otherwise fall back to global
    const buyThreshold = pScoring.buy_threshold || 70;
    const watchThreshold = pScoring.watch_threshold || 40;

    // ── COOLDOWN: check if 2+ consecutive losses in last hour → pause 10 min ──
    let cooldownActive = false;
    try {
      const { data: recentClosedLosses } = await supabase
        .from("open_positions")
        .select("close_reason, closed_at, pnl_pct")
        .eq("status", "closed")
        .in("close_reason", ["stop_loss", "fast_loss_cut"])
        .order("closed_at", { ascending: false })
        .limit(2);

      if (recentClosedLosses && recentClosedLosses.length >= 2) {
        const lastLossTime = new Date(recentClosedLosses[0].closed_at).getTime();
        const secondLossTime = new Date(recentClosedLosses[1].closed_at).getTime();
        const bothRecent = (Date.now() - lastLossTime) < 60 * 60 * 1000; // within 1h
        const bothConsecutive = (lastLossTime - secondLossTime) < 30 * 60 * 1000; // within 30min of each other
        const cooldownExpiry = lastLossTime + 10 * 60 * 1000; // 10 min cooldown
        
        if (bothRecent && bothConsecutive && Date.now() < cooldownExpiry) {
          cooldownActive = true;
          const remainingMin = Math.round((cooldownExpiry - Date.now()) / 60000);
          console.warn(`[bot] 🧊 COOLDOWN ACTIVE — 2 consecutive losses, ${remainingMin}min remaining`);
          await supabase.from("notifications").insert({
            type: "cooldown",
            title: "🧊 Cooldown aktywny — 2 straty z rzędu",
            message: `Bot pauzuje kupno na ${remainingMin} min po 2 kolejnych stratach.`,
            details: { remaining_min: remainingMin },
          });
        }
      }
    } catch (cooldownErr) {
      console.warn("[bot] Cooldown check error:", cooldownErr);
    }

    // ── DAILY LOSS LIMIT: check if daily losses > 0.1 SOL ──
    let dailyLossExceeded = false;
    try {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const { data: todayClosedPositions } = await supabase
        .from("open_positions")
        .select("pnl_pct, amount_sol")
        .eq("status", "closed")
        .gte("closed_at", todayStart.toISOString());

      if (todayClosedPositions) {
        const dailyLossSol = todayClosedPositions.reduce((sum: number, p: any) => {
          const pnlSol = (Number(p.pnl_pct) / 100) * Number(p.amount_sol);
          return pnlSol < 0 ? sum + Math.abs(pnlSol) : sum;
        }, 0);
        
        if (dailyLossSol >= 0.1) {
          dailyLossExceeded = true;
          console.warn(`[bot] 🚫 DAILY LOSS LIMIT — lost ${dailyLossSol.toFixed(4)} SOL today (limit: 0.1 SOL)`);
          await supabase.from("notifications").insert({
            type: "daily_loss",
            title: "🚫 Dzienny limit strat osiągnięty",
            message: `Strata dzisiaj: ${dailyLossSol.toFixed(4)} SOL ≥ 0.1 SOL. Kupno zablokowane do jutra.`,
            details: { daily_loss_sol: dailyLossSol, limit: 0.1 },
          });
        }
      }
    } catch (dlErr) {
      console.warn("[bot] Daily loss check error:", dlErr);
    }

    // 4. Analyze each wallet
    let totalTokensFound = 0;
    let totalSignals = 0;
    let totalBuySignals = 0;
    const allCandidates: any[] = [];
    const seenMints = new Set<string>();

    // Avoid re-buying already open/recently executed tokens
    // FIX #1: Also block ALL pending signals (no time limit) to prevent spam
    // FIX #3: Cooldown — block tokens that hit SL in last 48h
    const blockedMints = new Set<string>();
    const COOLDOWN_HOURS = 48;
    const [{ data: openPositions }, { data: recentSignals }, { data: pendingSignalMints }, { data: slCooldownMints }] = await Promise.all([
      supabase.from("open_positions").select("token_mint").eq("status", "open"),
      supabase
        .from("trading_signals")
        .select("token_mint")
        .eq("signal_type", "BUY")
        .eq("status", "executed")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      // Block ALL pending signal mints — prevents duplicate spam
      supabase
        .from("trading_signals")
        .select("token_mint")
        .eq("signal_type", "BUY")
        .eq("status", "pending"),
      // Cooldown: block tokens closed by stop_loss in last 48h
      supabase
        .from("open_positions")
        .select("token_mint")
        .eq("status", "closed")
        .eq("close_reason", "stop_loss")
        .gte("closed_at", new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString()),
    ]);

    for (const row of openPositions || []) blockedMints.add(row.token_mint);
    for (const row of recentSignals || []) blockedMints.add(row.token_mint);
    for (const row of pendingSignalMints || []) blockedMints.add(row.token_mint);
    for (const row of slCooldownMints || []) blockedMints.add(row.token_mint);
    console.log(`[bot] Blocked mints: ${blockedMints.size} (open=${openPositions?.length || 0}, executed=${recentSignals?.length || 0}, pending=${pendingSignalMints?.length || 0}, sl_cooldown=${slCooldownMints?.length || 0})`);

    for (const wallet of wallets) {
      try {
        // Fetch transactions
        const txRes = await fetch(
          `${HELIUS_BASE}/addresses/${wallet}/transactions?api-key=${heliusKey}&limit=50`
        );
        if (!txRes.ok) {
          console.error(`[bot] Wallet ${wallet.slice(0,8)} tx fetch failed: ${txRes.status}`);
          continue;
        }
        const txns = await txRes.json();
        console.log(`[bot] Wallet ${wallet.slice(0,8)}: ${txns.length} txns, lookback=${lookbackHours}h`);

        // Fetch token balances
        const balRes = await fetch(`${HELIUS_RPC}/?api-key=${heliusKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getAssetsByOwner",
            params: {
              ownerAddress: wallet,
              displayOptions: { showFungible: true, showNativeBalance: true },
            },
          }),
        });

        let tokens: any[] = [];
        let totalValueUsd = 0;
        if (balRes.ok) {
          const balJson = await balRes.json();
          const items = balJson.result?.items || [];
          const nativeBal = balJson.result?.nativeBalance;

          if (nativeBal) {
            const solAmt = nativeBal.lamports / 1e9;
            const solPrice = nativeBal.price_per_sol || 0;
            tokens.push({
              mint: "So11111111111111111111111111111111111111112",
              amount: solAmt,
              symbol: "SOL",
              priceUsd: solPrice,
              valueUsd: solAmt * solPrice,
            });
            totalValueUsd += solAmt * solPrice;
          }

          for (const item of items) {
            if (item.interface === "FungibleToken" || item.interface === "FungibleAsset") {
              const info = item.token_info || {};
              const meta = item.content?.metadata || {};
              const amount = (info.balance || 0) / Math.pow(10, info.decimals || 0);
              if (amount <= 0) continue;
              const priceUsd = info.price_info?.price_per_token || 0;
              const valueUsd = amount * priceUsd;
              tokens.push({
                mint: item.id,
                amount,
                symbol: info.symbol || meta.symbol || "???",
                name: meta.name || "Unknown",
                priceUsd,
                valueUsd,
              });
              totalValueUsd += valueUsd;
            }
          }
        }

        // Parse trades (recent buys)
        for (const tx of txns) {
          if (!tx?.timestamp || tx.timestamp <= lookbackSinceTs) continue;

          const tokenTransfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
          const incoming = tokenTransfers.find((t: any) => t?.toUserAccount === wallet && t?.mint);
          const outgoing = tokenTransfers.find((t: any) => t?.fromUserAccount === wallet && t?.mint);

          const incomingMint = incoming?.mint as string | undefined;
          const outgoingMint = outgoing?.mint as string | undefined;

          if (!incomingMint || BASE_ASSET_MINTS.has(incomingMint) || blockedMints.has(incomingMint)) continue;

          const isDirectBuy = !!incoming && !outgoing;
          const isBaseToTokenSwap = !!incoming && !!outgoing && !!outgoingMint && BASE_ASSET_MINTS.has(outgoingMint);
          const isSwapLikeTx = tx.type === "SWAP" || tx.type === "UNKNOWN" || tx.type === "TRANSFER";

          // Accept only probable buy-like movements
          if (!(isDirectBuy || (isBaseToTokenSwap && isSwapLikeTx))) continue;

          if (!seenMints.has(incomingMint)) {
            seenMints.add(incomingMint);

            // Quick security check
            const tokenInfo = tokens.find((t: any) => t.mint === incomingMint);
            const isSafe = KNOWN_SAFE_MINTS.has(incomingMint);
            const hasPrice = tokenInfo ? tokenInfo.priceUsd > 0 : false;
            const valueUsd = tokenInfo?.valueUsd || 0;

            // FIX #2: Real liquidity check via DexScreener API
            const minLiquidityUsd = Number(pLiquidity.min_value_usd || 15000);
            let realLiquidityUsd = 0;
            let volume5m = 0;
            let topHolderPct = 0;
            let hasMintAuth = false;
            let hasFreezeAuth = false;
            let tokenAgeMinutes = 0;

            try {
              const dexRes = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${incomingMint}`);
              if (dexRes.ok) {
                const dexPairs = await dexRes.json();
                const pairs = Array.isArray(dexPairs) ? dexPairs : [];
                const topPair = pairs.sort((a: any, b: any) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0];
                realLiquidityUsd = pairs.reduce((max: number, p: any) => Math.max(max, Number(p?.liquidity?.usd || 0)), 0);
                volume5m = Number(topPair?.volume?.m5 || 0);
                // Estimate token age from pair creation
                if (topPair?.pairCreatedAt) {
                  tokenAgeMinutes = Math.round((Date.now() - topPair.pairCreatedAt) / 60000);
                }
              }
            } catch (_) { /* DexScreener unreachable */ }

            const effectiveLiquidity = realLiquidityUsd > 0 ? realLiquidityUsd : valueUsd;

            // ── PUMP.FUN FILTERS ──
            // Liquidity filter
            if (pLiquidity.enabled && effectiveLiquidity < minLiquidityUsd) {
              console.log(`[bot] REJECT ${incomingMint.slice(0,8)}: liquidity $${effectiveLiquidity.toFixed(0)} < $${minLiquidityUsd}`);
              continue;
            }
            // Volume 5m filter ($40k minimum)
            if (volume5m > 0 && volume5m < 40000) {
              console.log(`[bot] REJECT ${incomingMint.slice(0,8)}: volume5m $${volume5m.toFixed(0)} < $40000`);
              continue;
            }
            // Token age filter (max 30 minutes)
            if (tokenAgeMinutes > 0 && tokenAgeMinutes > 30) {
              console.log(`[bot] REJECT ${incomingMint.slice(0,8)}: age ${tokenAgeMinutes}min > 30min`);
              continue;
            }

            if (realLiquidityUsd > 0) {
              console.log(`[bot] PASS ${incomingMint.slice(0,8)}: liq=$${realLiquidityUsd.toFixed(0)}, vol5m=$${volume5m.toFixed(0)}, age=${tokenAgeMinutes}min`);
            }

            // ── NEW SCORING SYSTEM ──
            // Volume explosion signal → +25
            // EMA crossover → +20
            // RSI momentum → +15
            // Liquidity OK → +10
            // Security checks → +10
            // Smart wallets buying → +10
            // Holder distribution OK → +10
            // Max = 100

            let totalScore = 0;

            // Security checks (+10)
            const securityScore = pSecurity.enabled
              ? (isSafe ? 10 : hasPrice ? 7 : 3)
              : 10;
            totalScore += securityScore;

            // Liquidity OK (+10)
            const liquidityScore = pLiquidity.enabled
              ? (effectiveLiquidity > 100000 ? 10 : effectiveLiquidity > 30000 ? 8 : effectiveLiquidity > 15000 ? 6 : 3)
              : 10;
            totalScore += liquidityScore;

            // Smart wallets buying (+10)
            const walletScore = pWallet.enabled
              ? (totalValueUsd > 100000 ? 10 : totalValueUsd > 10000 ? 7 : totalValueUsd > 50 ? 5 : 2)
              : 10;
            totalScore += walletScore;

            // ── Technical Strategy Scoring ──
            // Volume explosion → +25, EMA crossover → +20, RSI momentum → +15
            let taTriggered: string[] = [];
            if (enabledTAStrategies.length > 0 && realLiquidityUsd > 0) {
              try {
                const candles = await fetchCandleData(incomingMint);
                if (candles.length >= 3) {
                  const marketData = { candles, ageMinutes: tokenAgeMinutes || 0 };
                  if (marketData.ageMinutes === 0) {
                    const oldestTs = candles[0]?.timestamp || 0;
                    if (oldestTs > 0) marketData.ageMinutes = Math.round((Date.now() / 1000 - oldestTs) / 60);
                  }
                  taTriggered = evaluateTAStrategies(enabledTAStrategies, marketData);

                  // Volume Explosion signal → +25
                  if (taTriggered.includes("volume_explosion")) totalScore += 25;
                  // Triple Momentum → +20 (EMA crossover component)
                  if (taTriggered.includes("triple_momentum")) totalScore += 20;
                  // EMA Ribbon → +20
                  if (taTriggered.includes("ema_ribbon")) totalScore += 20;
                  // RSI-based strategies → +15
                  if (taTriggered.includes("rsi_divergence") || taTriggered.includes("vwap_reversion")) totalScore += 15;

                  // RSI momentum bonus (if RSI > 48 on any triggered strategy) → +15
                  if (taTriggered.length > 0) {
                    const rsiVal = taRsi(14, candles.map(c => c.close));
                    if (rsiVal > 48) totalScore += 15;
                  }

                  if (taTriggered.length > 0) {
                    const phase = marketData.ageMinutes < 15 ? "launch" : marketData.ageMinutes < 45 ? "momentum" : marketData.ageMinutes < 120 ? "trending" : "mature";
                    console.log(`[bot] TA score for ${incomingMint.slice(0,8)}: phase=${phase}, triggered=[${taTriggered.join(",")}], total=${totalScore}`);
                  }
                }
              } catch (taErr) {
                console.warn(`[bot] TA eval error for ${incomingMint.slice(0,8)}:`, taErr);
              }
            }

            // Holder distribution OK → +10 (always give if we passed filters)
            totalScore += 10;

            // Cap at 100
            totalScore = Math.min(100, totalScore);

            totalTokensFound++;

            const decision = totalScore >= buyThreshold ? "BUY" : totalScore >= watchThreshold ? "WATCH" : "SKIP";

            const fallbackSymbol = `${incomingMint.slice(0, 4)}...${incomingMint.slice(-4)}`;
            const resolvedSymbol = incoming?.tokenSymbol || tokenInfo?.symbol || fallbackSymbol;
            const resolvedName = tokenInfo?.name || incoming?.tokenName || resolvedSymbol;

            allCandidates.push({
              mint: incomingMint,
              symbol: resolvedSymbol,
              name: resolvedName,
              sourceWallet: wallet,
              securityScore,
              liquidityScore,
              walletScore,
              totalScore,
              decision,
              valueUsd,
              totalValueUsd,
              ta_strategies: taTriggered,
            });

            if (decision === "BUY") totalBuySignals++;
          }
        }

        // Fallback: if no recent buy-like transfer found, use high-value non-base holdings
        const walletHasCandidate = allCandidates.some((c) => c.sourceWallet === wallet);
        if (!walletHasCandidate) {
          const minLiquidityUsd = Math.max(5000, Number(pLiquidity.min_value_usd || 5000));

          for (const token of tokens) {
            const mint = token?.mint as string | undefined;
            if (!mint || BASE_ASSET_MINTS.has(mint) || seenMints.has(mint) || blockedMints.has(mint)) continue;

            const walletValueUsd = Number(token?.valueUsd || 0);
            
            // Real liquidity check via DexScreener
            let realLiquidityUsd = 0;
            try {
              const dexRes = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`);
              if (dexRes.ok) {
                const dexPairs = await dexRes.json();
                const pairs = Array.isArray(dexPairs) ? dexPairs : [];
                realLiquidityUsd = pairs.reduce((max: number, p: any) => Math.max(max, Number(p?.liquidity?.usd || 0)), 0);
              }
            } catch (_) { /* fallback */ }

            const effectiveLiquidity = realLiquidityUsd > 0 ? realLiquidityUsd : walletValueUsd;
            if (effectiveLiquidity < minLiquidityUsd) continue;

            seenMints.add(mint);
            totalTokensFound++;

            const hasPrice = Number(token?.priceUsd || 0) > 0;
            const isSafe = KNOWN_SAFE_MINTS.has(mint);

            const securityScore = pSecurity.enabled
              ? (isSafe ? 100 : hasPrice ? 60 : 30)
              : 70;
            const liquidityScore = pLiquidity.enabled
              ? (effectiveLiquidity > 100000 ? 80 : effectiveLiquidity > 10000 ? 60 : effectiveLiquidity > 1000 ? 40 : 20)
              : 60;
            const walletScore = pWallet.enabled
              ? (totalValueUsd > 100000 ? 80 : totalValueUsd > 10000 ? 60 : 40)
              : 60;

            const totalScore = Math.round(
              securityScore * 0.3 + liquidityScore * 0.25 + walletScore * 0.45
            );
            const decision = totalScore >= buyThreshold ? "BUY" : totalScore >= watchThreshold ? "WATCH" : "SKIP";
            const fallbackSymbol = `${mint.slice(0, 4)}...${mint.slice(-4)}`;
            const resolvedSymbol = token?.symbol || fallbackSymbol;
            const resolvedName = token?.name || resolvedSymbol;

            allCandidates.push({
              mint,
              symbol: resolvedSymbol,
              name: resolvedName,
              sourceWallet: wallet,
              source: "holding_snapshot",
              securityScore,
              liquidityScore,
              walletScore,
              totalScore,
              decision,
              valueUsd: walletValueUsd,
              totalValueUsd,
            });

            if (decision === "BUY") totalBuySignals++;
          }
        }
      } catch (err) {
        console.error(`Wallet ${wallet} error:`, err);
      }
    }

    // 4b. Smart Money Correlation — bonus if 2+ wallets bought same token
    if (pCorrelation.enabled) {
      const mintWalletCount: Record<string, Set<string>> = {};
      for (const c of allCandidates) {
        if (!mintWalletCount[c.mint]) mintWalletCount[c.mint] = new Set();
        mintWalletCount[c.mint].add(c.sourceWallet);
      }
      for (const c of allCandidates) {
        const walletsBuying = mintWalletCount[c.mint]?.size || 1;
        if (walletsBuying >= (pCorrelation.min_wallets || 2)) {
          const correlationBonus = Math.min(walletsBuying * (pCorrelation.bonus_per_wallet || 8), pCorrelation.max_bonus || 20);
          c.totalScore = Math.min(100, c.totalScore + correlationBonus);
          c.correlationBonus = correlationBonus;
          c.correlationWallets = walletsBuying;
          c.decision = c.totalScore >= buyThreshold ? "BUY" : c.totalScore >= watchThreshold ? "WATCH" : "SKIP";
        }
      }
    }
    // Recount buy signals after correlation
    totalBuySignals = allCandidates.filter((c) => c.decision === "BUY").length;

    // 4c. AI Sentiment analysis for BUY candidates (if enabled)
    if (pSentiment.enabled) {
      const buySignals = allCandidates.filter((c) => c.decision === "BUY");
      for (const candidate of buySignals) {
        try {
          const sentimentRes = await fetch(`${supabaseUrl}/functions/v1/token-sentiment`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ tokenSymbol: candidate.symbol, tokenMint: candidate.mint }),
          });
          if (sentimentRes.ok) {
            const sentimentData = await sentimentRes.json();
            if (sentimentData.success && sentimentData.analysis) {
              candidate.sentiment = sentimentData.analysis;
              const sentScore = sentimentData.analysis.sentiment_score || 0;
              const sentimentAdjust = Math.round(sentScore / 10);
              candidate.totalScore = Math.max(0, Math.min(100, candidate.totalScore + sentimentAdjust));
              candidate.sentimentAdjust = sentimentAdjust;
              if (pSentiment.block_on_avoid && (sentimentData.analysis.recommendation === "AVOID" || sentScore < -50)) {
                candidate.decision = "WATCH";
                candidate.totalScore = Math.min(candidate.totalScore, 60);
              }
            }
          }
        } catch (sentErr) {
          console.error(`Sentiment error for ${candidate.symbol}:`, sentErr);
        }
      }
    }

    // Recount after sentiment adjustment
    totalBuySignals = allCandidates.filter((c) => c.decision === "BUY").length;

    // 5. Save BUY signals to trading_signals
    const finalBuySignals = allCandidates.filter((c) => c.decision === "BUY");
    const signals = finalBuySignals.map((c) => ({
      wallet_address: c.sourceWallet,
      token_mint: c.mint,
      token_symbol: c.symbol,
      token_name: c.name,
      signal_type: "BUY",
      strategy: "Bot Pipeline (auto)",
      smart_score: c.walletScore,
      risk_score: 100 - c.securityScore,
      confidence: c.totalScore,
      conditions: {
        security_score: c.securityScore,
        liquidity_score: c.liquidityScore,
        wallet_score: c.walletScore,
        total_score: c.totalScore,
        source: "cron_monitor",
        value_usd: c.valueUsd,
        correlation_wallets: c.correlationWallets || 1,
        correlation_bonus: c.correlationBonus || 0,
        sentiment: c.sentiment?.sentiment || "unknown",
        sentiment_score: c.sentiment?.sentiment_score || 0,
        sentiment_adjust: c.sentimentAdjust || 0,
        ta_strategies: c.ta_strategies || [],
      },
      status: "pending",
    }));

    if (signals.length > 0) {
      const { error: insertSignalsError } = await supabase.from("trading_signals").insert(signals);
      if (insertSignalsError) throw insertSignalsError;
      totalSignals = signals.length;

      // Send notifications for each signal
      const notifications = signals.map((s: any) => ({
        type: "signal",
        title: `🔔 Sygnał BUY: ${s.token_symbol}`,
        message: `Wykryto sygnał kupna ${s.token_symbol} z confidence ${s.confidence}%. Źródło: ${s.wallet_address.slice(0, 6)}...${s.wallet_address.slice(-4)}`,
        details: { token_mint: s.token_mint, token_symbol: s.token_symbol, confidence: s.confidence, wallet: s.wallet_address },
      }));
      await supabase.from("notifications").insert(notifications);
    }

      // 5b. Auto-execute pending BUY signals if enabled (or missing config)
      const { data: autoExecConfig } = await supabase
        .from("bot_config")
        .select("value")
        .eq("key", "auto_execute")
        .single();

      const autoExecuteEnabled = autoExecConfig?.value !== false;

      // ── SELL-ONLY MODE: block ALL buys if enabled ──
      const { data: sellOnlyConfig } = await supabase
        .from("bot_config")
        .select("value")
        .eq("key", "sell_only_mode")
        .maybeSingle();
      const sellOnlyMode = sellOnlyConfig?.value === true || sellOnlyConfig?.value === "true";

      // ── BALANCE GUARD: block buys if balance < min_balance_sol ──
      const { data: minBalConfig } = await supabase
        .from("bot_config")
        .select("value")
        .eq("key", "min_balance_sol")
        .maybeSingle();
      const minBalanceSol = Number(minBalConfig?.value) || 0.5;

      let balanceTooLow = false;
      try {
        const solPubKey = Deno.env.get("SOLANA_PUBLIC_KEY");
        if (solPubKey) {
          const balRpc = Deno.env.get("HELIUS_API_KEY")
            ? `https://mainnet.helius-rpc.com/?api-key=${Deno.env.get("HELIUS_API_KEY")}`
            : "https://api.mainnet-beta.solana.com";
          const balRes = await fetch(balRpc, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0", id: 1,
              method: "getBalance",
              params: [solPubKey],
            }),
          });
          const balData = await balRes.json();
          const balanceSol = (balData?.result?.value || 0) / 1e9;
          console.log(`[bot] Wallet balance: ${balanceSol.toFixed(4)} SOL, min required: ${minBalanceSol} SOL`);
          if (balanceSol < minBalanceSol) {
            balanceTooLow = true;
            console.warn(`[bot] ⚠️ Balance ${balanceSol.toFixed(4)} SOL < ${minBalanceSol} SOL — BUY BLOCKED`);
            await supabase.from("notifications").insert({
              type: "balance_guard",
              title: "⚠️ Balans poniżej limitu — kupno zablokowane",
              message: `Saldo: ${balanceSol.toFixed(4)} SOL < ${minBalanceSol} SOL. Tylko sprzedaż aktywna.`,
              details: { balance: balanceSol, min_required: minBalanceSol },
            });
          }
        }
      } catch (balErr) {
        console.warn("[bot] Balance check error:", balErr);
      }

      const buyBlocked = sellOnlyMode || balanceTooLow || cooldownActive || dailyLossExceeded;
      if (buyBlocked) {
        console.log(`[bot] 🚫 BUY BLOCKED — sell_only=${sellOnlyMode}, balance_low=${balanceTooLow}, cooldown=${cooldownActive}, daily_loss=${dailyLossExceeded}`);
        // Reject all pending signals
        await supabase.from("trading_signals").update({ status: "rejected" }).eq("status", "pending").eq("signal_type", "BUY");
      }

      if (autoExecuteEnabled && !buyBlocked) {
        // Check max open positions limit
        const { data: maxPosConfig } = await supabase
          .from("bot_config")
          .select("value")
          .eq("key", "max_open_positions")
          .single();
        const maxOpenPositions = (maxPosConfig?.value as number) || 3;

        const { count: currentOpen } = await supabase
          .from("open_positions")
          .select("*", { count: "exact", head: true })
          .eq("status", "open");

        if ((currentOpen || 0) >= maxOpenPositions) {
          console.log(`Skipping auto-execute: ${currentOpen}/${maxOpenPositions} positions open`);
          // Still save signals as pending, just don't execute
        } else {
          const { data: posConfig } = await supabase
            .from("bot_config")
            .select("value")
            .eq("key", "max_position_sol")
            .single();
          const basePositionSol = (posConfig?.value as number) || 0.1;

          // Get trailing stop settings
          const { data: tsConfig } = await supabase
            .from("bot_config")
            .select("value")
            .eq("key", "trailing_stop_pct")
            .single();
          const trailingStopPct = (tsConfig?.value as number) || 4;

          const { data: tpConfig } = await supabase
            .from("bot_config")
            .select("value")
            .eq("key", "take_profit_pct")
            .single();
          const takeProfitPct = (tpConfig?.value as number) || 999; // TP disabled — trailing stop manages exits

          const slotsAvailable = maxOpenPositions - (currentOpen || 0);
          let executed = 0;

          // Execute oldest pending BUY signals first (including older pending ones)
          const { data: pendingSignals } = await supabase
            .from("trading_signals")
            .select("id, token_mint, token_symbol, token_name, confidence")
            .eq("signal_type", "BUY")
            .eq("status", "pending")
            .order("created_at", { ascending: true })
            .limit(100);

          // FIX #3: Deduplicate pending signals — only execute first per token_mint
          const executedMints = new Set<string>();
          for (const signal of pendingSignals || []) {
            if (executed >= slotsAvailable) {
              console.log(`Max positions reached (${maxOpenPositions}), queuing remaining signals`);
              break;
            }

            // Skip if we already tried this token_mint in this batch
            if (executedMints.has(signal.token_mint)) {
              await supabase.from("trading_signals").update({ status: "rejected" }).eq("id", signal.id);
              continue;
            }

            // Min confidence ≥70 for auto-execute
            if ((signal.confidence || 0) < 70) {
              console.log(`[bot] Skipping signal ${signal.id}: confidence ${signal.confidence} < 70`);
              await supabase.from("trading_signals").update({ status: "rejected" }).eq("id", signal.id);
              continue;
            }

            if (signal.token_mint === "So11111111111111111111111111111111111111112") {
              await supabase
                .from("trading_signals")
                .update({ status: "rejected" })
                .eq("id", signal.id);
              continue;
            }

            // Dynamic sizing based on score table
            let positionSol = 0.03; // minimum
            const confidence = Number(signal.confidence || 0);
            if (confidence >= 85) positionSol = 0.15;
            else if (confidence >= 75) positionSol = 0.10;
            else if (confidence >= 65) positionSol = 0.07;
            else positionSol = 0.03;

            const success = await executeBuySignal({
              supabase,
              supabaseUrl,
              supabaseKey,
              signal,
              positionSol,
              trailingStopPct,
              takeProfitPct,
            });

            if (success) {
              executed++;
              executedMints.add(signal.token_mint);
            }
          }

          // FIX #5: Cleanup old pending signals (>6h old) — reject them to prevent infinite accumulation
          try {
            const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
            const { count } = await supabase
              .from("trading_signals")
              .update({ status: "expired" })
              .eq("status", "pending")
              .lt("created_at", cutoff)
              .select("*", { count: "exact", head: true });
            if (count && count > 0) {
              console.log(`[bot] Expired ${count} old pending signals (>6h)`);
            }
          } catch (cleanupErr) {
            console.warn("Pending signals cleanup error:", cleanupErr);
          }
        }

        // After processing buys, also check open positions (trailing stop / TP)
        try {
          await fetch(`${supabaseUrl}/functions/v1/position-monitor`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ triggered_by: "bot-monitor" }),
          });
        } catch (pmErr) {
          console.error("Position monitor trigger error:", pmErr);
        }
      }

    // 6. Update run record
    await updateRun(supabase, runId, {
      status: "completed",
      finished_at: new Date().toISOString(),
      wallets_scanned: wallets.length,
      tokens_found: totalTokensFound,
      signals_generated: totalSignals,
      buy_signals: totalBuySignals,
      duration_ms: Date.now() - startTime,
      details: {
        candidates: allCandidates.length,
        wallets_count: wallets.length,
        lookback_hours: lookbackHours,
      },
    });

    return jsonResponse({
      success: true,
      wallets_scanned: wallets.length,
      tokens_found: totalTokensFound,
      signals_generated: totalSignals,
      buy_signals: totalBuySignals,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Bot monitor error:", msg);

    await updateRun(supabase, runId, {
      status: "error",
      finished_at: new Date().toISOString(),
      error_message: msg,
      duration_ms: Date.now() - startTime,
    });

    return jsonResponse({ success: false, error: msg }, 500);
  }
});

async function executeBuySignal({
  supabase,
  supabaseUrl,
  supabaseKey,
  signal,
  positionSol,
  trailingStopPct,
  takeProfitPct,
}: {
  supabase: any;
  supabaseUrl: string;
  supabaseKey: string;
  signal: { id: string; token_mint: string; token_symbol: string | null; token_name: string | null; confidence?: number | null };
  positionSol: number;
  trailingStopPct: number;
  takeProfitPct: number;
}) {
  const fallbackSymbol = signal.token_mint?.slice(0, 4) ? `${signal.token_mint.slice(0, 4)}...${signal.token_mint.slice(-4)}` : "???";
  const symbol = signal.token_symbol || signal.token_name || fallbackSymbol;

  try {
    // ── Deduplikacja: sprawdź czy nie ma już otwartej pozycji na ten token ──
    const { data: existingPos } = await supabase
      .from("open_positions")
      .select("id")
      .eq("token_mint", signal.token_mint)
      .eq("status", "open")
      .limit(1);

    if (existingPos && existingPos.length > 0) {
      console.log(`[bot] Skipping BUY ${symbol} — open position already exists (${existingPos[0].id})`);
      await supabase.from("trading_signals").update({ status: "rejected" }).eq("id", signal.id);
      return false;
    }

    const swapRes = await fetch(`${supabaseUrl}/functions/v1/execute-swap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        action: "BUY",
        tokenMint: signal.token_mint,
        amountSol: positionSol,
        slippageBps: 150,
      }),
    });

    const swapData = await swapRes.json();

    if (!swapData.success) {
      await supabase.from("notifications").insert({
        type: "swap_error",
        title: `❌ Auto-swap nieudany: ${symbol}`,
        message: `Błąd: ${swapData.error?.slice(0, 100) || "Nieznany błąd"}`,
        details: { error: swapData.error, token: symbol, mint: signal.token_mint, signal_id: signal.id },
      });
      return false;
    }

    const entryPrice = await fetchTokenUsdPrice(signal.token_mint);

    await supabase.from("open_positions").insert({
      signal_id: signal.id,
      token_mint: signal.token_mint,
      token_symbol: symbol,
      entry_price_usd: entryPrice,
      current_price_usd: entryPrice,
      highest_price_usd: entryPrice,
      amount_sol: positionSol,
      token_amount: swapData.outputAmount ? Number(swapData.outputAmount) / 1e6 : 0,
      trailing_stop_pct: trailingStopPct,
      take_profit_pct: takeProfitPct,
      stop_price_usd: entryPrice * (1 - trailingStopPct / 100),
      status: "open",
    });

    // Auto-log to trader journal
    try {
      const { data: profile } = await supabase.from("profiles").select("id").limit(1).single();
      if (profile) {
        await supabase.from("journal_entries").insert({
          user_id: profile.id,
          entry_type: "auto",
          title: `Auto BUY: ${symbol}`,
          notes: `Bot automatycznie kupił ${symbol} za ${positionSol} SOL. Confidence: ${signal.confidence}%. Smart Score: ${signal.smart_score}. Strategia: ${signal.strategy}.`,
          token_symbol: symbol,
          token_mint: signal.token_mint,
          action: "BUY",
          amount_sol: positionSol,
          tags: ["auto", "bot", signal.strategy?.includes("Pipeline") ? "pipeline" : "manual"].filter(Boolean),
        });
      }
    } catch (journalErr) {
      console.warn("Journal auto-log error (BUY):", journalErr);
    }

    await supabase.from("notifications").insert({
      type: "swap_success",
      title: `✅ Auto-swap: ${symbol}`,
      message: `Kupiono ${symbol} za ${positionSol} SOL. Trailing SL: ${trailingStopPct}%, TP: ${takeProfitPct}%. TX: ${swapData.txSignature?.slice(0, 12)}...`,
      details: {
        tx: swapData.txSignature,
        token: symbol,
        amount_sol: positionSol,
        mint: signal.token_mint,
        signal_id: signal.id,
        trailing_stop_pct: trailingStopPct,
        take_profit_pct: takeProfitPct,
      },
    });

    await supabase.from("trading_signals").update({
      status: "executed",
      executed_at: new Date().toISOString(),
      tx_signature: swapData.txSignature || null,
    }).eq("id", signal.id);

    return true;
  } catch (swapErr: any) {
    await supabase.from("notifications").insert({
      type: "swap_error",
      title: `❌ Auto-swap błąd: ${symbol}`,
      message: `Wyjątek: ${swapErr.message?.slice(0, 100) || "Nieznany błąd"}`,
      details: { error: swapErr.message, token: symbol, mint: signal.token_mint, signal_id: signal.id },
    });
    return false;
  }
}

async function fetchTokenUsdPrice(tokenMint: string): Promise<number> {
  // 1) Jupiter Lite price API
  try {
    const priceRes = await fetch(`https://lite-api.jup.ag/price/v2?ids=${encodeURIComponent(tokenMint)}`);
    if (priceRes.ok) {
      const priceData = await priceRes.json();
      const jupPrice = Number(priceData?.data?.[tokenMint]?.price);
      if (Number.isFinite(jupPrice) && jupPrice > 0) return jupPrice;
    }
  } catch (_) {
    // ignore
  }

  // 2) DexScreener fallback
  try {
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    if (dexRes.ok) {
      const dexData = await dexRes.json();
      const pairs = Array.isArray(dexData?.pairs) ? dexData.pairs : [];
      const validPairs = pairs
        .filter((p: any) => Number(p?.priceUsd) > 0)
        .sort((a: any, b: any) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
      const dexPrice = Number(validPairs[0]?.priceUsd);
      if (Number.isFinite(dexPrice) && dexPrice > 0) return dexPrice;
    }
  } catch (_) {
    // ignore
  }

  return 0;
}

async function updateRun(supabase: any, runId: string | undefined, data: Record<string, any>) {
  if (!runId) return;
  await supabase.from("bot_runs").update(data).eq("id", runId);
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// ─── Technical Analysis Helpers (inlined for Edge Functions) ───

interface TACandle {
  open: number; high: number; low: number; close: number; volume: number; timestamp: number;
}

function taEma(period: number, prices: number[]): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = prices[0];
  for (let i = 0; i < prices.length; i++) {
    const value = prices[i] * k + prev * (1 - k);
    result.push(value);
    prev = value;
  }
  return result;
}

function taRsi(period: number, prices: number[]): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length - 1; i++) {
    const diff = prices[i + 1] - prices[i];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  return 100 - 100 / (1 + gains / (losses || 1));
}

function taAvgVolume(candles: TACandle[], length: number): number {
  const slice = candles.slice(-length);
  return slice.reduce((sum, c) => sum + c.volume, 0) / (slice.length || 1);
}

function taVwap(candles: TACandle[]): number {
  let pv = 0, vol = 0;
  for (const c of candles) { const p = (c.high + c.low + c.close) / 3; pv += p * c.volume; vol += c.volume; }
  return vol > 0 ? pv / vol : 0;
}

const TA_CONFIG = {
  volume_explosion: { emaShort: 9, emaLong: 21, volumeMultiplier: 3, rsiThreshold: 48, maxAgeMinutes: 45 },
  rsi_divergence: { volumeMultiplier: 3.5, rsiOversold: 35 },
  ema_ribbon: { ribbon: [8, 13, 21, 34, 55], volumeMultiplier: 2.5, rsiMin: 45 },
  vwap_reversion: { volumeMultiplier: 3, rsiMax: 40, minAge: 10 },
  triple_momentum: { emaShort: 9, emaLong: 21, emaTrend: 200, rsiBuy: 50, volumeMultiplier: 3.5, maxAgeMinutes: 60 },
};

// Age-based phase selection
function selectPhase(ageMinutes: number): string {
  if (ageMinutes < 15) return "launch";
  if (ageMinutes < 45) return "momentum";
  if (ageMinutes < 120) return "trending";
  return "mature";
}

function getPhaseStrategies(phase: string): string[] {
  switch (phase) {
    case "launch": return ["volume_explosion"];
    case "momentum": return ["volume_explosion", "triple_momentum"];
    case "trending": return ["ema_ribbon", "triple_momentum"];
    case "mature": return ["rsi_divergence", "vwap_reversion"];
    default: return [];
  }
}

function evaluateStrategy(s: string, p: number[], vol: number, avgVol: number, r: number, md: { candles: TACandle[]; ageMinutes: number }): boolean {
  if (s === "volume_explosion") {
    const cfg = TA_CONFIG.volume_explosion;
    const e9 = taEma(cfg.emaShort, p), e21 = taEma(cfg.emaLong, p);
    return e9.length >= 2 && e21.length >= 2 &&
      e9.at(-2)! < e21.at(-2)! && e9.at(-1)! > e21.at(-1)! &&
      vol > avgVol * cfg.volumeMultiplier && r > cfg.rsiThreshold &&
      md.ageMinutes < cfg.maxAgeMinutes;
  } else if (s === "rsi_divergence") {
    const cfg = TA_CONFIG.rsi_divergence;
    return vol > avgVol * cfg.volumeMultiplier && r < cfg.rsiOversold;
  } else if (s === "ema_ribbon") {
    const cfg = TA_CONFIG.ema_ribbon;
    const ribbon = cfg.ribbon.map(e => taEma(e, p).at(-1)!);
    const bullish = ribbon.every((v, i, arr) => i === 0 || v > arr[i - 1]);
    return bullish && p.at(-1)! <= ribbon[0] && vol > avgVol * cfg.volumeMultiplier && r > cfg.rsiMin;
  } else if (s === "vwap_reversion") {
    const cfg = TA_CONFIG.vwap_reversion;
    const vw = taVwap(md.candles);
    return p.at(-1)! < vw && vol > avgVol * cfg.volumeMultiplier && r < cfg.rsiMax && md.ageMinutes > cfg.minAge;
  } else if (s === "triple_momentum") {
    const cfg = TA_CONFIG.triple_momentum;
    const e9 = taEma(cfg.emaShort, p), e21 = taEma(cfg.emaLong, p), e200 = taEma(cfg.emaTrend, p);
    return e9.at(-1)! > e21.at(-1)! && p.at(-1)! > e200.at(-1)! &&
      vol > avgVol * cfg.volumeMultiplier && r > cfg.rsiBuy &&
      md.ageMinutes < cfg.maxAgeMinutes;
  }
  return false;
}

function evaluateTAStrategies(enabled: string[], md: { candles: TACandle[]; ageMinutes: number }): string[] {
  const p = md.candles.map(c => c.close);
  const vol = md.candles.at(-1)?.volume || 0;
  const avgVol = taAvgVolume(md.candles, 10);
  const r = taRsi(14, p);

  // Age-based strategy selection with confirmation layer
  const phase = selectPhase(md.ageMinutes);
  const phaseStrategies = getPhaseStrategies(phase);
  
  // Only evaluate strategies that are both in the phase AND enabled by user
  const candidates = phaseStrategies.filter(s => enabled.includes(s));
  const triggered = candidates.filter(s => evaluateStrategy(s, p, vol, avgVol, r, md));
  
  console.log(`[TA] Phase: ${phase} (${md.ageMinutes}min), candidates: [${candidates.join(",")}], triggered: [${triggered.join(",")}]`);
  return triggered;
}

async function fetchCandleData(tokenMint: string): Promise<TACandle[]> {
  // Use DexScreener OHLCV-like data from pairs
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${tokenMint}`);
    if (!res.ok) return [];
    const pairs = await res.json();
    const pair = Array.isArray(pairs) && pairs.length > 0 ? pairs[0] : null;
    if (!pair) return [];

    // DexScreener doesn't provide raw OHLCV, synthesize from price history
    // Use txns data to approximate candles
    const price = Number(pair.priceUsd || 0);
    const volume24h = Number(pair.volume?.h24 || 0);
    const volume1h = Number(pair.volume?.h1 || 0);
    const volume5m = Number(pair.volume?.m5 || 0);
    const priceChange5m = Number(pair.priceChange?.m5 || 0) / 100;
    const priceChange1h = Number(pair.priceChange?.h1 || 0) / 100;

    if (price <= 0) return [];

    const now = Math.floor(Date.now() / 1000);
    // Synthesize ~20 candles from available data
    const candles: TACandle[] = [];
    const price1hAgo = price / (1 + priceChange1h);
    const price5mAgo = price / (1 + priceChange5m);

    for (let i = 0; i < 20; i++) {
      const t = now - (20 - i) * 180; // 3-min intervals
      const progress = i / 19;
      const p = price1hAgo + (price - price1hAgo) * progress;
      const noise = 1 + (Math.sin(i * 1.7) * 0.01);
      candles.push({
        open: p * noise,
        high: p * (1 + Math.abs(Math.sin(i)) * 0.02),
        low: p * (1 - Math.abs(Math.cos(i)) * 0.02),
        close: i === 19 ? price : p * noise,
        volume: i >= 18 ? volume5m : volume1h / 12,
        timestamp: t,
      });
    }
    return candles;
  } catch {
    return [];
  }
}
