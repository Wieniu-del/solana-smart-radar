import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HELIUS_BASE = "https://api.helius.xyz/v0";
const HELIUS_RPC = "https://mainnet.helius-rpc.com";

// Base assets & stablecoins (never BUY these)
const BASE_ASSET_MINTS = new Set([
  "So11111111111111111111111111111111111111112",   // SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",  // USDT
  "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",   // USD1
  "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",   // USDS
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj",  // stSOL
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",   // mSOL
  "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",   // bSOL
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

  // Auto-cleanup stale "running" bot_runs (older than 5 minutes)
  await supabase
    .from("bot_runs")
    .update({ status: "completed", finished_at: new Date().toISOString(), details: { reason: "auto_cleanup_stale" } })
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());

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

    let wallets: string[] = (walletsConfig?.value as string[]) || [];
    if (wallets.length === 0) {
      await updateRun(supabase, runId, {
        status: "completed",
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        details: { reason: "No tracked wallets" },
      });
      return jsonResponse({ success: true, status: "no_wallets" });
    }

    // ── WALLET PnL AUDIT: exclude wallets that generated mostly losses ──
    const { data: walletPnlConfig } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "wallet_pnl_audit")
      .maybeSingle();
    const walletPnlAudit = (walletPnlConfig?.value as any) || {};
    const auditEnabled = walletPnlAudit.enabled !== false; // enabled by default
    const minTradesForAudit = Number(walletPnlAudit.min_trades) || 3;
    const maxLossRatePct = Number(walletPnlAudit.max_loss_rate_pct) || 80; // exclude if 80%+ of signals were losses

    if (auditEnabled) {
      // Get per-wallet signal performance from closed positions
      const { data: closedPositions } = await supabase
        .from("open_positions")
        .select("signal_id, pnl_pct, close_reason, token_mint")
        .eq("status", "closed");

      const { data: signalSources } = await supabase
        .from("trading_signals")
        .select("id, wallet_address")
        .eq("signal_type", "BUY");

      if (closedPositions && signalSources) {
        const signalWalletMap = new Map<string, string>();
        for (const s of signalSources) signalWalletMap.set(s.id, s.wallet_address);

        const walletStats: Record<string, { total: number; losses: number; deadTokens: number }> = {};
        for (const pos of closedPositions) {
          const wallet = pos.signal_id ? signalWalletMap.get(pos.signal_id) : null;
          if (!wallet) continue;
          if (!walletStats[wallet]) walletStats[wallet] = { total: 0, losses: 0, deadTokens: 0 };
          walletStats[wallet].total++;
          if (Number(pos.pnl_pct) < 0) walletStats[wallet].losses++;
          if (pos.close_reason === "dead_token") walletStats[wallet].deadTokens++;
        }

        const excludedWallets: string[] = [];
        for (const [wallet, stats] of Object.entries(walletStats)) {
          if (stats.total >= minTradesForAudit) {
            const lossRate = (stats.losses / stats.total) * 100;
            if (lossRate >= maxLossRatePct || stats.deadTokens >= 2) {
              excludedWallets.push(wallet);
              console.log(`[bot] ❌ WALLET EXCLUDED: ${wallet.slice(0,8)}... — ${stats.losses}/${stats.total} losses (${lossRate.toFixed(0)}%), dead_tokens=${stats.deadTokens}`);
            }
          }
        }

        if (excludedWallets.length > 0) {
          const before = wallets.length;
          wallets = wallets.filter(w => !excludedWallets.includes(w));
          console.log(`[bot] Wallet audit: excluded ${excludedWallets.length} bad wallets (${before} → ${wallets.length})`);
          
          if (wallets.length === 0) {
            await updateRun(supabase, runId, {
              status: "completed",
              finished_at: new Date().toISOString(),
              duration_ms: Date.now() - startTime,
              details: { reason: "All wallets excluded by PnL audit", excluded: excludedWallets.map(w => w.slice(0,8)) },
            });
            return jsonResponse({ success: true, status: "all_wallets_excluded", excluded: excludedWallets.length });
          }
        }
      }
    }

    // 3. Get scoring threshold
    const { data: thresholdConfig } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "min_score_threshold")
      .single();
    const minScoreThreshold = (thresholdConfig?.value as number) || 45;

    // 3b. Dynamic sizing table (score-based)
    const dynamicSizing = {
      enabled: true,
      table: [
        { minScore: 85, sol: 0.20 },
        { minScore: 70, sol: 0.15 },
        { minScore: 55, sol: 0.10 },
        { minScore: 45, sol: 0.05 },
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
    const pLiquidity = pipelineConfig.liquidity_check ?? { enabled: true, min_value_usd: 3000 };
    const pWallet = pipelineConfig.wallet_analysis ?? { enabled: true, min_wallet_value_usd: 20 };
    const pScoring = pipelineConfig.scoring ?? { buy_threshold: 45, watch_threshold: 25 };
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
    const buyThreshold = pScoring.buy_threshold || 45;
    const watchThreshold = pScoring.watch_threshold || 25;

    // ── COOLDOWN: DISABLED per user request ──
    const cooldownActive = false;

    // ── DAILY LOSS LIMIT: DISABLED per user request ──
    const dailyLossExceeded = false;

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
    const SL_COOLDOWN_HOURS = 12;
    const TD_COOLDOWN_HOURS = 24; // Don't rebuy tokens that ended with time_decay for 24h (was 6h)
    const [{ data: openPositions }, { data: recentSignals }, { data: pendingSignalMints }, { data: slCooldownMints }, { data: tdCooldownMints }] = await Promise.all([
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
      // Cooldown: block tokens closed by stop_loss in last 12h
      supabase
        .from("open_positions")
        .select("token_mint")
        .eq("status", "closed")
        .eq("close_reason", "stop_loss")
        .gte("closed_at", new Date(Date.now() - SL_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString()),
      // Cooldown: block tokens closed by time_decay in last 6h (no rebuy stagnant tokens)
      supabase
        .from("open_positions")
        .select("token_mint")
        .eq("status", "closed")
        .eq("close_reason", "time_decay")
        .gte("closed_at", new Date(Date.now() - TD_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString()),
    ]);

    for (const row of openPositions || []) blockedMints.add(row.token_mint);
    for (const row of recentSignals || []) blockedMints.add(row.token_mint);
    for (const row of pendingSignalMints || []) blockedMints.add(row.token_mint);
    for (const row of slCooldownMints || []) blockedMints.add(row.token_mint);
    for (const row of tdCooldownMints || []) blockedMints.add(row.token_mint);
    console.log(`[bot] Blocked mints: ${blockedMints.size} (open=${openPositions?.length || 0}, executed=${recentSignals?.length || 0}, pending=${pendingSignalMints?.length || 0}, sl_cooldown=${slCooldownMints?.length || 0}, td_cooldown=${tdCooldownMints?.length || 0})`);

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
            const minLiquidityUsd = Number(pLiquidity.min_value_usd || 3000);
            let realLiquidityUsd = 0;
            let volume5m = 0;
            let topHolderPct = 0;
            let hasMintAuth = false;
            let hasFreezeAuth = false;
            let tokenAgeMinutes = 0;

            // FIX: Try multiple APIs for liquidity data
            let dexPairsData: any[] = []; // store for LP lock check
            try {
              // Try DexScreener v1 first
              const dexRes = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${incomingMint}`);
              if (dexRes.ok) {
                const dexPairs = await dexRes.json();
                const pairs = Array.isArray(dexPairs) ? dexPairs : [];
                dexPairsData = pairs;
                if (pairs.length > 0) {
                  const topPair = pairs.sort((a: any, b: any) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0];
                  realLiquidityUsd = pairs.reduce((max: number, p: any) => Math.max(max, Number(p?.liquidity?.usd || 0)), 0);
                  volume5m = Number(topPair?.volume?.m5 || 0);
                  if (topPair?.pairCreatedAt) {
                    tokenAgeMinutes = Math.round((Date.now() - topPair.pairCreatedAt) / 60000);
                  }
                }
              }

              // Fallback: try legacy DexScreener endpoint if v1 returned nothing
              if (realLiquidityUsd <= 0) {
                const dexRes2 = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${incomingMint}`);
                if (dexRes2.ok) {
                  const dexData2 = await dexRes2.json();
                  const pairs2 = Array.isArray(dexData2?.pairs) ? dexData2.pairs : [];
                  dexPairsData = pairs2.length > 0 ? pairs2 : dexPairsData;
                  if (pairs2.length > 0) {
                    realLiquidityUsd = pairs2.reduce((max: number, p: any) => Math.max(max, Number(p?.liquidity?.usd || 0)), 0);
                    volume5m = Number(pairs2[0]?.volume?.m5 || 0);
                    if (pairs2[0]?.pairCreatedAt) {
                      tokenAgeMinutes = Math.round((Date.now() - new Date(pairs2[0].pairCreatedAt).getTime()) / 60000);
                    }
                  }
                }
              }

              // Fallback: estimate from Jupiter price if still no liquidity data
              if (realLiquidityUsd <= 0) {
                try {
                  const jupRes = await fetch(`https://lite-api.jup.ag/price/v2?ids=${encodeURIComponent(incomingMint)}`);
                  if (jupRes.ok) {
                    const jupData = await jupRes.json();
                    const jupPrice = Number(jupData?.data?.[incomingMint]?.price);
                    if (jupPrice > 0) {
                      realLiquidityUsd = 15000;
                      console.log(`[bot] ${incomingMint.slice(0,8)}: Jupiter price=$${jupPrice.toFixed(8)}, estimated liq=$15000`);
                    }
                  }
                } catch (_) {}
              }
            } catch (dexErr) {
              console.warn(`[bot] DexScreener error for ${incomingMint.slice(0,8)}:`, dexErr);
            }

            // ── LP LOCK VERIFICATION ──
            // Check if liquidity is locked/burned (rugpull protection)
            let lpLocked = false;
            let lpLockScore = 0;
            if (dexPairsData.length > 0) {
              const topPair = dexPairsData.sort((a: any, b: any) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0];
              // Check for burn address or lock indicators
              const lpAddress = topPair?.liquidity?.base?.address || topPair?.info?.lpAddress || "";
              const hasLpBurn = topPair?.info?.lpBurned === true;
              const lpLockedPct = Number(topPair?.info?.lpLockedPct || 0);
              // Alternative: check if LP tokens were sent to dead/burn addresses
              const pairAddress = topPair?.pairAddress || "";

              // DexScreener sometimes provides lock info in info.socials or info object
              if (hasLpBurn || lpLockedPct >= 90) {
                lpLocked = true;
                lpLockScore = 10;
                console.log(`[bot] ✅ LP LOCKED: ${incomingMint.slice(0,8)} — burned=${hasLpBurn}, locked=${lpLockedPct}%`);
              } else {
                // Heuristic: if LP has been stable for >30 min and liq > $50k, likely safer
                if (realLiquidityUsd > 50000 && tokenAgeMinutes > 30) {
                  lpLockScore = 5;
                  console.log(`[bot] ⚠️ LP NOT CONFIRMED LOCKED: ${incomingMint.slice(0,8)} — but liq=$${realLiquidityUsd.toFixed(0)}, age=${tokenAgeMinutes}min (OK)`);
                } else if (realLiquidityUsd < 30000 && tokenAgeMinutes < 15) {
                  // New token, low liq, no LP lock — HIGH RISK
                  console.log(`[bot] ❌ REJECT LP RISK: ${incomingMint.slice(0,8)} — no LP lock, liq=$${realLiquidityUsd.toFixed(0)}, age=${tokenAgeMinutes}min`);
                  continue;
                }
              }
            }

            const effectiveLiquidity = realLiquidityUsd > 0 ? realLiquidityUsd : valueUsd;

            // ── PUMP.FUN SCAM DETECTION ──
            const symbolLower = (incoming?.tokenSymbol || tokenInfo?.symbol || "").toLowerCase();
            const isPumpFun = incomingMint.endsWith("pump") || symbolLower.includes("pump");
            if (isPumpFun && realLiquidityUsd < 50000) {
              console.log(`[bot] ❌ PUMP.FUN REJECT: ${incomingMint.slice(0,8)} — pump token with liq=$${realLiquidityUsd.toFixed(0)} < $50k`);
              continue;
            }

            // ── MARKET FILTERS ──
            // Liquidity filter
            if (pLiquidity.enabled && effectiveLiquidity < minLiquidityUsd) {
              console.log(`[bot] REJECT ${incomingMint.slice(0,8)}: liquidity $${effectiveLiquidity.toFixed(0)} < $${minLiquidityUsd}`);
              continue;
            }
            // Volume 5m filter ($5k minimum — relaxed to allow more signals through)
            if (volume5m > 0 && volume5m < 2000) {
              console.log(`[bot] REJECT ${incomingMint.slice(0,8)}: volume5m $${volume5m.toFixed(0)} < $2000`);
              continue;
            }
            // Token age filter (max 360 minutes — expanded from 120min to catch established tokens)
            if (tokenAgeMinutes > 0 && tokenAgeMinutes > 720) {
              console.log(`[bot] REJECT ${incomingMint.slice(0,8)}: age ${tokenAgeMinutes}min > 720min`);
              continue;
            }

            // ── MOMENTUM PRE-CHECK: reject tokens with negative short-term momentum ──
            let priceChangeM5 = 0;
            let priceChangeH1 = 0;
            if (dexPairsData.length > 0) {
              const topPair = dexPairsData.sort((a: any, b: any) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0];
              priceChangeM5 = Number(topPair?.priceChange?.m5 || 0);
              priceChangeH1 = Number(topPair?.priceChange?.h1 || 0);
              // Hard reject: falling fast
              if (priceChangeM5 < -10) {
                console.log(`[bot] ❌ MOMENTUM PRE-REJECT: ${incomingMint.slice(0,8)} — m5=${priceChangeM5.toFixed(1)}% (dumping)`);
                continue;
              }
            }

            if (realLiquidityUsd > 0) {
              console.log(`[bot] PASS ${incomingMint.slice(0,8)}: liq=$${realLiquidityUsd.toFixed(0)}, vol5m=$${volume5m.toFixed(0)}, age=${tokenAgeMinutes}min, m5=${priceChangeM5.toFixed(1)}%`);
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

            // ── SNIPER SCORING ENGINE ──
            // Multi-signal scoring: the more confirmations, the higher the score
            // Volume explosion → +25, EMA crossover → +20, RSI momentum → +15
            let taTriggered: string[] = [];
            let velocityBonus = 0;
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

                  // ── VELOCITY DETECTION: tokens gaining momentum FAST get bonus ──
                  // This is the "cunning sniper" edge — spot acceleration before others
                  if (priceChangeM5 > 3 && volume5m > 20000) {
                    velocityBonus = 10; // strong velocity
                    console.log(`[bot] 🎯 VELOCITY DETECTED: ${incomingMint.slice(0,8)} — m5=+${priceChangeM5.toFixed(1)}%, vol5m=$${volume5m.toFixed(0)} → +${velocityBonus} bonus`);
                  } else if (priceChangeM5 > 1 && volume5m > 10000) {
                    velocityBonus = 5; // moderate velocity
                  }
                  totalScore += velocityBonus;

                  // ── MULTI-STRATEGY BONUS: 2+ strategies confirm = stronger signal ──
                  if (taTriggered.length >= 2) {
                    const multiBonus = Math.min(taTriggered.length * 5, 15);
                    totalScore += multiBonus;
                    console.log(`[bot] 🔥 MULTI-CONFIRM: ${incomingMint.slice(0,8)} — ${taTriggered.length} strategies triggered → +${multiBonus} bonus`);
                  }

                  if (taTriggered.length > 0) {
                    const phase = marketData.ageMinutes < 15 ? "launch" : marketData.ageMinutes < 45 ? "momentum" : marketData.ageMinutes < 120 ? "trending" : "mature";
                    console.log(`[bot] TA score for ${incomingMint.slice(0,8)}: phase=${phase}, triggered=[${taTriggered.join(",")}], velocity=${velocityBonus}, total=${totalScore}`);
                  }
                }
              } catch (taErr) {
                console.warn(`[bot] TA eval error for ${incomingMint.slice(0,8)}:`, taErr);
              }
            }

            // Holder distribution OK → +10 (always give if we passed filters)
            totalScore += 10;

            // LP Lock bonus → +10 if locked, +5 if high liq
            totalScore += lpLockScore;

            // Cap at 100
            totalScore = Math.min(100, totalScore);

            // ── QUALITY GATE v3 (AGGRESSIVE): accept with TA OR decent liquidity ──
            const hasStrongQuality = taTriggered.length > 0;
            const hasDefensiveQuality = realLiquidityUsd > 20000 && priceChangeM5 > -3;
            if (!hasStrongQuality && !hasDefensiveQuality) {
              console.log(`[bot] ❌ QUALITY GATE v3: ${incomingMint.slice(0,8)} — no TA, liq=$${realLiquidityUsd.toFixed(0)}, m5=${priceChangeM5.toFixed(1)}% → SKIP`);
              continue;
            }

            totalTokensFound++;

            const decision = totalScore >= buyThreshold ? "BUY" : totalScore >= watchThreshold ? "WATCH" : "SKIP";

            const fallbackSymbol = `${incomingMint.slice(0, 4)}...${incomingMint.slice(-4)}`;
            const resolvedSymbol = incoming?.tokenSymbol || tokenInfo?.symbol || fallbackSymbol;
            const resolvedName = tokenInfo?.name || incoming?.tokenName || resolvedSymbol;

            // Fetch initial price for delay entry check
            let initialPriceUsd = 0;
            try {
              initialPriceUsd = await fetchTokenUsdPrice(incomingMint);
            } catch (_) {}

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
              initialPriceUsd,
              lpLocked,
              lpLockScore,
              velocityBonus,
              priceChangeM5,
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

    // ══════════════════════════════════════════════════════════════
    // ── DISCOVERY ENGINE: find tokens BEYOND tracked wallets ──
    // Sources: DexScreener Trending, Volume Scanner, New Pools
    // ══════════════════════════════════════════════════════════════
    const { data: discoveryConfig } = await supabase
      .from("bot_config").select("value").eq("key", "discovery_sources").maybeSingle();
    const discSrc = (discoveryConfig?.value as any) || {
      dexscreener_trending: true, volume_scanner: true, new_pools: true,
    };

    const discoveredMints: Array<{ mint: string; source: string }> = [];

    // ── Source 1: DexScreener Trending/Boosted Tokens ──
    if (discSrc.dexscreener_trending !== false) {
      try {
        const trendRes = await fetch("https://api.dexscreener.com/token-boosts/top/v1");
        if (trendRes.ok) {
          const data = await trendRes.json();
          const solTokens = (Array.isArray(data) ? data : [])
            .filter((t: any) => t.chainId === "solana" && t.tokenAddress)
            .slice(0, 10);
          for (const t of solTokens) discoveredMints.push({ mint: t.tokenAddress, source: "trending" });
          console.log(`[discovery] 🔥 Trending: found ${solTokens.length} Solana tokens`);
        }
      } catch (e) { console.warn("[discovery] trending error:", e); }
    }

    // ── Source 2: DexScreener Latest Token Profiles (New Pools) ──
    if (discSrc.new_pools !== false) {
      try {
        const profRes = await fetch("https://api.dexscreener.com/token-profiles/latest/v1");
        if (profRes.ok) {
          const data = await profRes.json();
          const solTokens = (Array.isArray(data) ? data : [])
            .filter((t: any) => t.chainId === "solana" && t.tokenAddress)
            .slice(0, 15);
          for (const t of solTokens) discoveredMints.push({ mint: t.tokenAddress, source: "new_pool" });
          console.log(`[discovery] 🆕 New pools: found ${solTokens.length} Solana tokens`);
        }
      } catch (e) { console.warn("[discovery] new pools error:", e); }
    }

    // ── Source 3: Volume Scanner — high-volume Solana pairs ──
    if (discSrc.volume_scanner !== false) {
      try {
        const volRes = await fetch("https://api.dexscreener.com/latest/dex/search?q=SOL");
        if (volRes.ok) {
          const volData = await volRes.json();
          const pairs = Array.isArray(volData?.pairs) ? volData.pairs : [];
          const highVolPairs = pairs
            .filter((p: any) =>
              p.chainId === "solana" &&
              Number(p?.volume?.h1 || 0) > 50000 &&
              Number(p?.liquidity?.usd || 0) > 20000 &&
              p.baseToken?.address
            )
            .sort((a: any, b: any) => Number(b?.volume?.h1 || 0) - Number(a?.volume?.h1 || 0))
            .slice(0, 10);
          for (const p of highVolPairs) discoveredMints.push({ mint: p.baseToken.address, source: "volume_scan" });
          console.log(`[discovery] 📊 Volume scanner: found ${highVolPairs.length} high-volume pairs`);
        }
      } catch (e) { console.warn("[discovery] volume scanner error:", e); }
    }

    // ── Process discovered tokens through the SAME pipeline ──
    const discDedup = new Set<string>();
    const uniqueDiscovered = discoveredMints.filter(d => {
      if (seenMints.has(d.mint) || blockedMints.has(d.mint) || BASE_ASSET_MINTS.has(d.mint) || discDedup.has(d.mint)) return false;
      discDedup.add(d.mint);
      return true;
    });

    console.log(`[discovery] Processing ${uniqueDiscovered.length} unique discovered tokens`);

    let discProcessed = 0;
    for (const disc of uniqueDiscovered) {
      try {
        // Rate limit: max 15 tokens from discovery per cycle + small delay
        if (discProcessed >= 15) break;
        discProcessed++;
        seenMints.add(disc.mint);

        // Full DexScreener evaluation
        let realLiquidityUsd = 0, volume5m = 0, tokenAgeMinutes = 0;
        let priceChangeM5 = 0, priceChangeH1 = 0;
        let dexPairsData: any[] = [];
        let tokenSymbol = "", tokenName = "", tokenPrice = 0;

        const dexRes = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${disc.mint}`);
        if (dexRes.ok) {
          const pairs = await dexRes.json();
          dexPairsData = Array.isArray(pairs) ? pairs : [];
          if (dexPairsData.length > 0) {
            const topPair = dexPairsData.sort((a: any, b: any) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0];
            realLiquidityUsd = dexPairsData.reduce((max: number, p: any) => Math.max(max, Number(p?.liquidity?.usd || 0)), 0);
            volume5m = Number(topPair?.volume?.m5 || 0);
            priceChangeM5 = Number(topPair?.priceChange?.m5 || 0);
            priceChangeH1 = Number(topPair?.priceChange?.h1 || 0);
            tokenPrice = Number(topPair?.priceUsd || 0);
            tokenSymbol = topPair?.baseToken?.symbol || `${disc.mint.slice(0, 4)}...${disc.mint.slice(-4)}`;
            tokenName = topPair?.baseToken?.name || tokenSymbol;
            if (topPair?.pairCreatedAt) tokenAgeMinutes = Math.round((Date.now() - topPair.pairCreatedAt) / 60000);
          }
        }

        if (realLiquidityUsd <= 0 || tokenPrice <= 0) continue;

        // Market filters (same thresholds as wallet-sourced)
        const minLiq = Number(pLiquidity.min_value_usd || 3000);
        if (realLiquidityUsd < minLiq) { console.log(`[discovery] REJECT ${tokenSymbol}: liq $${realLiquidityUsd.toFixed(0)} < $${minLiq}`); continue; }
        if (volume5m > 0 && volume5m < 2000) continue;
        if (tokenAgeMinutes > 720) continue;
        if (priceChangeM5 < -10) { console.log(`[discovery] ❌ MOMENTUM REJECT ${tokenSymbol}: m5=${priceChangeM5.toFixed(1)}%`); continue; }

        // Pump.fun filter
        const isPump = disc.mint.endsWith("pump") || tokenSymbol.toLowerCase().includes("pump");
        if (isPump && realLiquidityUsd < 50000) continue;

        // LP Lock check
        let lpLocked = false, lpLockScore = 0;
        if (dexPairsData.length > 0) {
          const topPair = dexPairsData[0];
          const hasLpBurn = topPair?.info?.lpBurned === true;
          const lpLockedPct = Number(topPair?.info?.lpLockedPct || 0);
          if (hasLpBurn || lpLockedPct >= 90) { lpLocked = true; lpLockScore = 10; }
          else if (realLiquidityUsd > 50000 && tokenAgeMinutes > 30) lpLockScore = 5;
          else if (realLiquidityUsd < 30000 && tokenAgeMinutes < 15) continue;
        }

        // Scoring
        let totalScore = 0;
        const securityScore = tokenPrice > 0 ? 7 : 3;
        const liquidityScore = realLiquidityUsd > 100000 ? 10 : realLiquidityUsd > 30000 ? 8 : 6;
        const walletScore = disc.source === "trending" ? 8 : disc.source === "volume_scan" ? 7 : 5;
        totalScore += securityScore + liquidityScore + walletScore;

        // TA analysis
        let taTriggered: string[] = [];
        let velocityBonus = 0;
        if (enabledTAStrategies.length > 0) {
          try {
            const candles = await fetchCandleData(disc.mint);
            if (candles.length >= 3) {
              const marketData = { candles, ageMinutes: tokenAgeMinutes };
              taTriggered = evaluateTAStrategies(enabledTAStrategies, marketData);
              if (taTriggered.includes("volume_explosion")) totalScore += 25;
              if (taTriggered.includes("triple_momentum")) totalScore += 20;
              if (taTriggered.includes("ema_ribbon")) totalScore += 20;
              if (taTriggered.includes("rsi_divergence") || taTriggered.includes("vwap_reversion")) totalScore += 15;
              if (taTriggered.length > 0) {
                const rsiVal = taRsi(14, candles.map(c => c.close));
                if (rsiVal > 48) totalScore += 15;
              }
              if (priceChangeM5 > 3 && volume5m > 20000) velocityBonus = 10;
              else if (priceChangeM5 > 1 && volume5m > 10000) velocityBonus = 5;
              totalScore += velocityBonus;
              if (taTriggered.length >= 2) totalScore += Math.min(taTriggered.length * 5, 15);
            }
          } catch (_) { /* TA error */ }
        }

        totalScore += 10 + lpLockScore; // holder dist + LP
        totalScore = Math.min(100, totalScore);

        // Quality Gate v2 — same as wallet-sourced
        const hasTA = taTriggered.length > 0;
        const hasDefensive = realLiquidityUsd > 20000 && priceChangeM5 > -3;
        if (!hasTA && !hasDefensive) {
          console.log(`[discovery] ❌ QUALITY GATE: ${tokenSymbol} — no TA, liq=$${realLiquidityUsd.toFixed(0)}`);
          continue;
        }

        totalTokensFound++;
        const decision = totalScore >= buyThreshold ? "BUY" : totalScore >= watchThreshold ? "WATCH" : "SKIP";

        let initialPriceUsd = 0;
        try { initialPriceUsd = await fetchTokenUsdPrice(disc.mint); } catch (_) {}

        allCandidates.push({
          mint: disc.mint,
          symbol: tokenSymbol,
          name: tokenName,
          sourceWallet: `discovery:${disc.source}`,
          securityScore,
          liquidityScore,
          walletScore,
          totalScore,
          decision,
          valueUsd: realLiquidityUsd,
          totalValueUsd: 0,
          ta_strategies: taTriggered,
          initialPriceUsd,
          lpLocked,
          lpLockScore,
          velocityBonus,
          priceChangeM5,
          source: disc.source,
        });

        if (decision === "BUY") {
          totalBuySignals++;
          console.log(`[discovery] 🎯 BUY: ${tokenSymbol} (${disc.source}) — score=${totalScore}, liq=$${realLiquidityUsd.toFixed(0)}, TA=[${taTriggered.join(",")}]`);
        }
      } catch (discErr) {
        console.warn(`[discovery] Error ${disc.mint.slice(0, 8)}:`, discErr);
      }
    }

    console.log(`[discovery] Done. Total candidates after discovery: ${allCandidates.length}`);

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
      strategy: (c.source === "trending" || c.source === "volume_scan" || c.source === "new_pool") ? `Discovery (${c.source})` : "Bot Pipeline (auto)",
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
        initial_price_usd: c.initialPriceUsd || 0, // for delay entry price check
        lp_locked: c.lpLocked || false,
        lp_lock_score: c.lpLockScore || 0,
        correlation_wallets: c.correlationWallets || 1,
        correlation_bonus: c.correlationBonus || 0,
        sentiment: c.sentiment?.sentiment || "unknown",
        sentiment_score: c.sentiment?.sentiment_score || 0,
        sentiment_adjust: c.sentimentAdjust || 0,
        ta_strategies: c.ta_strategies || [],
        velocity_bonus: c.velocityBonus || 0,
        price_change_m5: c.priceChangeM5 || 0,
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

      // 5b. Auto-execute pending BUY signals — use pipeline_config settings
      const pAutoExecute = pipelineConfig.auto_execute ?? { enabled: true, min_confidence: 45 };
      const autoExecuteEnabled = pAutoExecute.enabled !== false;
      const autoExecMinConfidence = Number(pAutoExecute.min_confidence) || 45;

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

      const executableSignalStatuses = ["pending", "approved"];
      const buyBlocked = sellOnlyMode || balanceTooLow || cooldownActive || dailyLossExceeded;
      if (buyBlocked) {
        console.log(`[bot] 🚫 BUY BLOCKED — sell_only=${sellOnlyMode}, balance_low=${balanceTooLow}, cooldown=${cooldownActive}, daily_loss=${dailyLossExceeded}`);
        // Reject all executable BUY signals
        await supabase
          .from("trading_signals")
          .update({ status: "rejected" })
          .in("status", executableSignalStatuses)
          .eq("signal_type", "BUY");
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

          // ── SNIPER MODE: fastest execution with smart verification ──
          // High-confidence signals (>=80) = INSTANT execution (0 delay)
          // Medium signals (65-79) = 2 min delay (quick verify)
          // Low signals (<65) = 3 min delay (standard verify)
          const SNIPER_INSTANT_THRESHOLD = 80;
          const SNIPER_FAST_DELAY = 2;
          const SNIPER_NORMAL_DELAY = 3;

          const { data: pendingSignals } = await supabase
            .from("trading_signals")
            .select("id, token_mint, token_symbol, token_name, confidence, status, strategy, smart_score, created_at, conditions")
            .eq("signal_type", "BUY")
            .in("status", executableSignalStatuses)
            .order("confidence", { ascending: false }) // SNIPER: execute HIGHEST confidence first, not oldest
            .limit(100);

          // Deduplicate pending signals — only execute first per token_mint
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

            // ── SNIPER DELAY: dynamic based on confidence ──
            const signalAge = (Date.now() - new Date(signal.created_at).getTime()) / 60000;
            const isManuallyApproved = signal.status === "approved";
            const signalConfidence = Number(signal.confidence || 0);
            const delayMinutes = signalConfidence >= SNIPER_INSTANT_THRESHOLD ? 0 
              : signalConfidence >= 65 ? SNIPER_FAST_DELAY 
              : SNIPER_NORMAL_DELAY;
            
            if (!isManuallyApproved && signalAge < delayMinutes) {
              console.log(`[bot] ⏳ SNIPER WAIT: ${signal.token_symbol} — conf=${signalConfidence}, age=${signalAge.toFixed(1)}min, need=${delayMinutes}min`);
              continue;
            }

            // ── SNIPER: price stability check (only if delay was > 0) ──
            if (!isManuallyApproved && delayMinutes > 0 && signalAge >= delayMinutes) {
              const conditions = signal.conditions as any || {};
              const initialPrice = Number(conditions.initial_price_usd || 0);
              if (initialPrice > 0) {
                try {
                  const currentPrice = await fetchTokenUsdPrice(signal.token_mint);
                  if (currentPrice > 0) {
                    const priceChange = ((currentPrice - initialPrice) / initialPrice) * 100;
                    // Reject if price dumped >30% since signal (pump & dump)
                    if (priceChange < -30) {
                      console.log(`[bot] ❌ DELAY REJECT: ${signal.token_symbol} — price dumped ${priceChange.toFixed(1)}% since signal ($${initialPrice.toFixed(8)} → $${currentPrice.toFixed(8)})`);
                      await supabase.from("trading_signals").update({ status: "rejected" }).eq("id", signal.id);
                      continue;
                    }
                    // Reject if price pumped >100% (likely too late / FOMO trap)
                    if (priceChange > 100) {
                      console.log(`[bot] ❌ DELAY REJECT: ${signal.token_symbol} — price pumped ${priceChange.toFixed(1)}% since signal (FOMO trap)`);
                      await supabase.from("trading_signals").update({ status: "rejected" }).eq("id", signal.id);
                      continue;
                    }
                    console.log(`[bot] ✅ DELAY PASS: ${signal.token_symbol} — price change ${priceChange.toFixed(1)}% after ${signalAge.toFixed(1)}min delay`);
                  }
                } catch (priceErr) {
                  console.warn(`[bot] Price check error for delay entry:`, priceErr);
                }
              }
            }

            // ── MOMENTUM FILTER v2: require ACTIVE upward movement ──
            if (!isManuallyApproved) {
              try {
                const dexMomRes = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${signal.token_mint}`);
                if (dexMomRes.ok) {
                  const dexMomPairs = await dexMomRes.json();
                  const momPairs = Array.isArray(dexMomPairs) ? dexMomPairs : [];
                  if (momPairs.length > 0) {
                    const topPair = momPairs.sort((a: any, b: any) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0];
                    const priceChangeM5 = Number(topPair?.priceChange?.m5 || 0);
                    const priceChangeH1 = Number(topPair?.priceChange?.h1 || 0);
                    const volume5m = Number(topPair?.volume?.m5 || 0);
                    
                    // Reject if price is falling fast (dumping)
                    if (priceChangeM5 < -3) {
                      console.log(`[bot] ❌ MOMENTUM REJECT: ${signal.token_symbol} — price falling ${priceChangeM5.toFixed(1)}% in 5min`);
                      await supabase.from("trading_signals").update({ status: "rejected" }).eq("id", signal.id);
                      continue;
                    }
                    // Require at least neutral momentum — m5 >= 0% OR h1 >= +2%
                    if (priceChangeM5 < 0 && priceChangeH1 < 2) {
                      console.log(`[bot] ❌ MOMENTUM REJECT: ${signal.token_symbol} — negative momentum: m5=${priceChangeM5.toFixed(1)}%, h1=${priceChangeH1.toFixed(1)}%`);
                      await supabase.from("trading_signals").update({ status: "rejected" }).eq("id", signal.id);
                      continue;
                    }
                    // Re-check volume at execution time
                    if (volume5m > 0 && volume5m < 3000) {
                      console.log(`[bot] ❌ VOLUME REJECT AT EXEC: ${signal.token_symbol} — vol5m=$${volume5m.toFixed(0)} < $3000`);
                      await supabase.from("trading_signals").update({ status: "rejected" }).eq("id", signal.id);
                      continue;
                    }
                    console.log(`[bot] ✅ MOMENTUM PASS: ${signal.token_symbol} — m5=+${priceChangeM5.toFixed(1)}%, h1=+${priceChangeH1.toFixed(1)}%, vol5m=$${volume5m.toFixed(0)}`);

            // Min confidence from pipeline config (manual approval bypasses this check)
            if (!isManuallyApproved && (signal.confidence || 0) < autoExecMinConfidence) {
              console.log(`[bot] Skipping signal ${signal.id}: confidence ${signal.confidence} < ${autoExecMinConfidence}`);
              await supabase.from("trading_signals").update({ status: "rejected" }).eq("id", signal.id);
              continue;
            }

            // Block base assets and stablecoins
            if (BASE_ASSET_MINTS.has(signal.token_mint)) {
              await supabase
                .from("trading_signals")
                .update({ status: "rejected" })
                .eq("id", signal.id);
              continue;
            }

            // ── SNIPER SIZING: aggressive scaling for high-confidence signals ──
            let positionSol = 0.03; // minimum
            const confidence = Number(signal.confidence || 0);
            const conditions = signal.conditions as any || {};
            const hasVelocity = Number(conditions.velocity_bonus || 0) > 0;
            if (confidence >= 90) positionSol = 0.15;       // max conviction
            else if (confidence >= 80) positionSol = 0.12;   // high confidence
            else if (confidence >= 75) positionSol = 0.10;
            else if (confidence >= 70) positionSol = 0.07;
            else positionSol = 0.05; // raised minimum from 0.03 — if we're entering, commit
            
            // Velocity bonus: +20% position size for accelerating tokens
            if (hasVelocity && positionSol < 0.15) {
              positionSol = Math.min(0.15, positionSol * 1.2);
              console.log(`[bot] 🎯 VELOCITY SIZE BOOST: ${signal.token_symbol} → ${positionSol.toFixed(3)} SOL`);
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

          // SNIPER: expire signals after 30min — stale signals are worthless
          try {
            const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
            const { data: expiredRows } = await supabase
              .from("trading_signals")
              .update({ status: "expired" })
              .eq("status", "pending")
              .lt("created_at", cutoff)
              .select("id");
            const expiredCount = expiredRows?.length || 0;
            if (expiredCount > 0) {
              console.log(`[bot] Expired ${expiredCount} old pending signals (>6h)`);
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
  signal: { id: string; token_mint: string; token_symbol: string | null; token_name: string | null; confidence?: number | null; status?: string | null; strategy?: string | null; smart_score?: number | null };
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
        slippageBps: 100, // SNIPER: tight slippage — we want good fills or no fill
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
  volume_explosion: { emaShort: 9, emaLong: 21, volumeMultiplier: 2.5, rsiThreshold: 45, maxAgeMinutes: 30 },
  rsi_divergence: { volumeMultiplier: 3.5, rsiOversold: 35 },
  ema_ribbon: { ribbon: [8, 13, 21, 34, 55], volumeMultiplier: 2.5, rsiMin: 45 },
  vwap_reversion: { volumeMultiplier: 3, rsiMax: 40, minAge: 10 },
  triple_momentum: { emaShort: 9, emaLong: 21, emaTrend: 50, rsiBuy: 48, volumeMultiplier: 3, maxAgeMinutes: 30 },
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
  try {
    // Try Birdeye-style OHLCV from DexScreener pairs data
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${tokenMint}`);
    if (!res.ok) return [];
    const pairs = await res.json();
    const pair = Array.isArray(pairs) && pairs.length > 0 
      ? pairs.sort((a: any, b: any) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0] 
      : null;
    if (!pair) return [];

    const price = Number(pair.priceUsd || 0);
    const volume24h = Number(pair.volume?.h24 || 0);
    const volume6h = Number(pair.volume?.h6 || 0);
    const volume1h = Number(pair.volume?.h1 || 0);
    const volume5m = Number(pair.volume?.m5 || 0);
    const priceChange5m = Number(pair.priceChange?.m5 || 0) / 100;
    const priceChange1h = Number(pair.priceChange?.h1 || 0) / 100;
    const priceChange6h = Number(pair.priceChange?.h6 || 0) / 100;

    if (price <= 0) return [];

    const now = Math.floor(Date.now() / 1000);
    const candles: TACandle[] = [];

    // Build more realistic candles using available multi-timeframe price changes
    const price6hAgo = price / (1 + priceChange6h);
    const price1hAgo = price / (1 + priceChange1h);
    const price5mAgo = price / (1 + priceChange5m);

    // 30 candles at 3-min intervals (90 min of data)
    const numCandles = 30;
    for (let i = 0; i < numCandles; i++) {
      const t = now - (numCandles - i) * 180;
      const progress = i / (numCandles - 1);

      // Piecewise interpolation: 0-0.67 uses 6h→1h, 0.67-0.97 uses 1h→5m, 0.97-1.0 uses 5m→now
      let p: number;
      if (progress < 0.67) {
        const localProg = progress / 0.67;
        p = price6hAgo + (price1hAgo - price6hAgo) * localProg;
      } else if (progress < 0.97) {
        const localProg = (progress - 0.67) / 0.30;
        p = price1hAgo + (price5mAgo - price1hAgo) * localProg;
      } else {
        const localProg = (progress - 0.97) / 0.03;
        p = price5mAgo + (price - price5mAgo) * localProg;
      }

      // Volume distribution: concentrate recent volume
      let vol: number;
      if (i >= numCandles - 2) vol = volume5m / 2;
      else if (i >= numCandles - 5) vol = volume1h / 8;
      else vol = (volume6h - volume1h) / Math.max(numCandles - 5, 1);

      // Realistic spread based on volume
      const spread = vol > 0 ? Math.min(0.03, 500 / (vol + 1)) : 0.01;

      candles.push({
        open: p * (1 - spread * 0.3),
        high: p * (1 + spread),
        low: p * (1 - spread),
        close: i === numCandles - 1 ? price : p,
        volume: Math.max(vol, 1),
        timestamp: t,
      });
    }
    return candles;
  } catch {
    return [];
  }
}
