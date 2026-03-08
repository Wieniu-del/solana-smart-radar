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

    // 3b. Get dynamic sizing config
    const { data: dynSizingConfig } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "dynamic_sizing")
      .single();
    const dynamicSizing = (dynSizingConfig?.value as { enabled: boolean; min_sol: number; max_sol: number }) || {
      enabled: false, min_sol: 0.05, max_sol: 0.5,
    };

    // 3c. Get pipeline config (user-adjustable feature toggles)
    const { data: pipelineConfigData } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "pipeline_config")
      .single();
    const pipelineConfig = (pipelineConfigData?.value as any) || {};
    const pSecurity = pipelineConfig.security_check ?? { enabled: true, min_score: 30 };
    const pLiquidity = pipelineConfig.liquidity_check ?? { enabled: true, min_value_usd: 1000 };
    const pWallet = pipelineConfig.wallet_analysis ?? { enabled: true, min_wallet_value_usd: 10000 };
    const pScoring = pipelineConfig.scoring ?? { buy_threshold: minScoreThreshold, watch_threshold: 45 };
    const pCorrelation = pipelineConfig.correlation ?? { enabled: true, min_wallets: 2, bonus_per_wallet: 8, max_bonus: 20 };
    const pSentiment = pipelineConfig.sentiment ?? { enabled: true, block_on_avoid: true };

    // Lookback window for wallet activity (default 72h to avoid empty scans)
    const { data: lookbackConfig } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "lookback_hours")
      .single();
    const lookbackHours = Math.max(6, Math.min(168, Number(lookbackConfig?.value || 72)));
    const lookbackSinceTs = Date.now() / 1000 - lookbackHours * 3600;

    // Use pipeline scoring thresholds if set, otherwise fall back to global
    const buyThreshold = pScoring.buy_threshold || minScoreThreshold;
    const watchThreshold = pScoring.watch_threshold || 45;

    // 4. Analyze each wallet
    let totalTokensFound = 0;
    let totalSignals = 0;
    let totalBuySignals = 0;
    const allCandidates: any[] = [];
    const seenMints = new Set<string>();

    // Avoid re-buying already open/recently executed tokens
    // FIX #1: Also block ALL pending signals (no time limit) to prevent spam
    const blockedMints = new Set<string>();
    const [{ data: openPositions }, { data: recentSignals }, { data: pendingSignalMints }] = await Promise.all([
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
    ]);

    for (const row of openPositions || []) blockedMints.add(row.token_mint);
    for (const row of recentSignals || []) blockedMints.add(row.token_mint);
    for (const row of pendingSignalMints || []) blockedMints.add(row.token_mint);
    console.log(`[bot] Blocked mints: ${blockedMints.size} (open=${openPositions?.length || 0}, executed=${recentSignals?.length || 0}, pending=${pendingSignalMints?.length || 0})`);

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

            // FIX #2: Hard reject tokens with liquidity < $5000
            if (pLiquidity.enabled && valueUsd < 5000) {
              console.log(`[bot] REJECT ${incomingMint.slice(0,8)}: liquidity $${valueUsd.toFixed(2)} < $5000 minimum`);
              continue;
            }

            // Scoring with pipeline config
            const securityScore = pSecurity.enabled
              ? (isSafe ? 100 : hasPrice ? 60 : 30)
              : 70; // neutral if disabled
            const liquidityScore = pLiquidity.enabled
              ? (valueUsd > 100000 ? 80 : valueUsd > 10000 ? 60 : valueUsd > 1000 ? 40 : 20)
              : 60; // neutral if disabled
            const walletScore = pWallet.enabled
              ? (totalValueUsd > 100000 ? 80 : totalValueUsd > 10000 ? 60 : 40)
              : 60; // neutral if disabled

            const totalScore = Math.round(
              securityScore * 0.3 + liquidityScore * 0.25 + walletScore * 0.45
            );

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
            });

            if (decision === "BUY") totalBuySignals++;
          }
        }

        // Fallback: if no recent buy-like transfer found, use high-value non-base holdings
        const walletHasCandidate = allCandidates.some((c) => c.sourceWallet === wallet);
        if (!walletHasCandidate) {
          // FIX #2: Use hard minimum $5000 for holding snapshot too
          const minLiquidityUsd = Math.max(5000, Number(pLiquidity.min_value_usd || 5000));

          for (const token of tokens) {
            const mint = token?.mint as string | undefined;
            if (!mint || BASE_ASSET_MINTS.has(mint) || seenMints.has(mint) || blockedMints.has(mint)) continue;

            const valueUsd = Number(token?.valueUsd || 0);
            if (valueUsd < minLiquidityUsd) continue;

            seenMints.add(mint);
            totalTokensFound++;

            const hasPrice = Number(token?.priceUsd || 0) > 0;
            const isSafe = KNOWN_SAFE_MINTS.has(mint);

            const securityScore = pSecurity.enabled
              ? (isSafe ? 100 : hasPrice ? 60 : 30)
              : 70;
            const liquidityScore = pLiquidity.enabled
              ? (valueUsd > 100000 ? 80 : valueUsd > 10000 ? 60 : valueUsd > 1000 ? 40 : 20)
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
              valueUsd,
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

      if (autoExecuteEnabled) {
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
          const trailingStopPct = (tsConfig?.value as number) || 10;

          const { data: tpConfig } = await supabase
            .from("bot_config")
            .select("value")
            .eq("key", "take_profit_pct")
            .single();
          const takeProfitPct = (tpConfig?.value as number) || 50;

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

            // FIX #3b: Min confidence ≥65 for auto-execute
            if ((signal.confidence || 0) < 65) {
              console.log(`[bot] Skipping signal ${signal.id}: confidence ${signal.confidence} < 65`);
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

            let positionSol = basePositionSol;
            if (dynamicSizing.enabled) {
              const confidence = Number(signal.confidence || 70);
              const scoreNorm = Math.max(0, Math.min(1, (confidence - 70) / 30));
              positionSol = dynamicSizing.min_sol + scoreNorm * (dynamicSizing.max_sol - dynamicSizing.min_sol);
              positionSol = Math.round(positionSol * 1000) / 1000;
            }

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
