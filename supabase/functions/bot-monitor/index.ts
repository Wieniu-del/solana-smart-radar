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

    for (const wallet of wallets) {
      try {
        // Fetch transactions
        const txRes = await fetch(
          `${HELIUS_BASE}/addresses/${wallet}/transactions?api-key=${heliusKey}&limit=50`
        );
        if (!txRes.ok) continue;
        const txns = await txRes.json();

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

          if (!incomingMint || BASE_ASSET_MINTS.has(incomingMint)) continue;

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

          for (const signal of pendingSignals || []) {
            if (executed >= slotsAvailable) {
              console.log(`Max positions reached (${maxOpenPositions}), queuing remaining signals`);
              break;
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

            if (success) executed++;
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

    let entryPrice = 0;
    try {
      const priceRes = await fetch(`https://api.jup.ag/price/v2?ids=${signal.token_mint}`);
      if (priceRes.ok) {
        const priceData = await priceRes.json();
        entryPrice = Number(priceData.data?.[signal.token_mint]?.price) || 0;
      }
    } catch (_) {
      // ignore price lookup failures
    }

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
