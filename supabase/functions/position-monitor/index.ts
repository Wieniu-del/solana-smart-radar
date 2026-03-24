import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SOLANA_RPC_DEFAULT = "https://api.mainnet-beta.solana.com";
const SELL_SLIPPAGE_STEPS = [300, 500, 800, 1200];
const SELL_FAILURE_LOOKBACK_MINUTES = 30;
const SELL_RATE_LIMIT_COOLDOWN_MS = 3 * 60 * 1000;
const SELL_NO_ROUTE_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_NO_ROUTE_ATTEMPTS_BEFORE_DUST_CLOSE = 3;
const DUST_VALUE_USD_THRESHOLD = 0.25;
const DUST_TOKEN_RATIO_THRESHOLD = 0.02;

// ─── TIERED TRAILING STOP TABLE ───
// Tightens as profit grows — protects mega-winners better
const TRAILING_TABLE = [
  { minPnl: 100, trailing: 15 },  // mega-winner: tight lock
  { minPnl: 50, trailing: 18 },
  { minPnl: 20, trailing: 20 },
  { minPnl: 10, trailing: 25 },   // moderate: some room
  { minPnl: 0, trailing: 30 },    // early: wide — let it develop
];

function getTrailingStopPct(pnlPct: number): number {
  for (const tier of TRAILING_TABLE) {
    if (pnlPct >= tier.minPnl) return tier.trailing;
  }
  return 30;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { data: positions, error: posErr } = await supabase
      .from("open_positions")
      .select("*")
      .eq("status", "open");

    if (posErr) throw posErr;
    if (!positions || positions.length === 0) {
      return jsonResponse({ success: true, message: "No open positions", checked: 0, closed: 0 });
    }

    const mints = [...new Set(positions.map((p: any) => p.token_mint))];
    const priceMap = await fetchTokenPrices(mints);

    // Load stop loss config (default -15%)
    const { data: slConfig } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "stop_loss_pct")
      .single();
    const STOP_LOSS_PCT = Number(slConfig?.value) || 15;

    // Load trailing start threshold (default 8%)
    const { data: trailingStartConfig } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "trailing_start_pct")
      .maybeSingle();
    const TRAILING_START_PCT = Number(trailingStartConfig?.value) || 3;

    let closedCount = 0;

    for (const pos of positions) {
      const currentPrice = priceMap[pos.token_mint] || 0;
      console.log(`[position-monitor] ${pos.token_symbol}: entry=$${Number(pos.entry_price_usd).toFixed(6)}, current=$${currentPrice.toFixed(6)}, pnl=${currentPrice > 0 && Number(pos.entry_price_usd) > 0 ? (((currentPrice - Number(pos.entry_price_usd)) / Number(pos.entry_price_usd)) * 100).toFixed(2) : '?'}%`);

      // ── DEAD TOKEN: no price for >30min → close (was 3h — too slow) ──
      if (currentPrice <= 0) {
        const lastUpdate = new Date(pos.updated_at).getTime();
        const minutesSinceUpdate = (Date.now() - lastUpdate) / (1000 * 60);
        const entryPrice = Number(pos.entry_price_usd) || 0;

        if (minutesSinceUpdate >= 30 || entryPrice <= 0) {
          console.warn(`[position-monitor] Dead token: ${pos.token_symbol} — no price ${minutesSinceUpdate.toFixed(0)}min, force-closing as -100%`);
          const closed = await closePosition(supabase, supabaseUrl, supabaseKey, pos, 0, "dead_token", -100);
          if (closed) closedCount++;
          continue;
        }
        console.warn(`[position-monitor] No price for ${pos.token_symbol}, waiting ${(30 - minutesSinceUpdate).toFixed(0)}min`);
        continue;
      }

      let entryPrice = Number(pos.entry_price_usd) || 0;
      if (entryPrice <= 0) {
        await supabase.from("open_positions").update({
          entry_price_usd: currentPrice,
          current_price_usd: currentPrice,
          highest_price_usd: currentPrice,
          stop_price_usd: currentPrice * (1 - 4 / 100),
          pnl_pct: 0,
          updated_at: new Date().toISOString(),
        }).eq("id", pos.id);
        continue;
      }

      const highestPrice = Math.max(Number(pos.highest_price_usd) || 0, currentPrice);
      const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
      const hoursHeld = (Date.now() - new Date(pos.opened_at).getTime()) / (1000 * 60 * 60);

      // ── TRAILING: activate at 3% profit — lock gains early ──
      const trailingActive = pnlPct >= TRAILING_START_PCT;
      const trailingStopPct = getTrailingStopPct(pnlPct);
      const stopPrice = trailingActive
        ? highestPrice * (1 - trailingStopPct / 100)
        : entryPrice * (1 - STOP_LOSS_PCT / 100); // hard SL before trailing activates

      // ── profit_fade & mini_profit_take REMOVED ──
      // Trailing stop 20% is the sole profit exit executor now.
      const minutesHeld = hoursHeld * 60;

      // ── CHECK CLOSE CONDITIONS ──
      let closeReason: string | null = null;

      // Hard stop loss
      if (pnlPct <= -STOP_LOSS_PCT) {
        closeReason = "stop_loss";
      }
      // Trailing stop hit (only when trailing is active)
      else if (trailingActive && currentPrice <= stopPrice) {
        closeReason = "trailing_stop";
      }

      // ── SNIPER FAST LOSS CUT: -4% in first 20min → cut immediately ──
      if (pnlPct <= -4 && hoursHeld < 0.33) {
        closeReason = "fast_loss_cut";
      }

      // ── TIME DECAY: after 180min with <8% profit → close ──
      // SKIP if mega-winner (PnL > 100%) — let trailing stop manage it
      if (minutesHeld >= 180 && pnlPct < 8 && pnlPct > -STOP_LOSS_PCT) {
        closeReason = "time_decay";
      }

      // ── MAX HOLD: after 3h force close — BUT NOT mega-winners ──
      // If PnL > 100%, trailing stop handles exit, not a dumb timeout
      if (hoursHeld >= 3 && !closeReason && pnlPct <= 100) {
        closeReason = "max_hold_time";
      }
      
      // Log mega-winner protection
      if (pnlPct > 100 && hoursHeld >= 3) {
        console.log(`[position-monitor] 🚀 MEGA-WINNER PROTECTED: ${pos.token_symbol} +${pnlPct.toFixed(1)}% held ${hoursHeld.toFixed(1)}h — trailing stop manages exit`);
      }

      if (closeReason) {
        const closed = await closePosition(supabase, supabaseUrl, supabaseKey, pos, currentPrice, closeReason, pnlPct);
        if (closed) closedCount++;
      } else {
        await supabase.from("open_positions").update({
          current_price_usd: currentPrice,
          highest_price_usd: highestPrice,
          stop_price_usd: stopPrice,
          pnl_pct: Math.round(pnlPct * 100) / 100,
          updated_at: new Date().toISOString(),
        }).eq("id", pos.id);
      }
    }

    console.log(`[position-monitor] Done: checked=${positions.length}, closed=${closedCount}, prices=${Object.keys(priceMap).length}`);
    return jsonResponse({ success: true, checked: positions.length, closed: closedCount, prices_fetched: Object.keys(priceMap).length });
  } catch (err: any) {
    console.error("Position monitor error:", err);
    return jsonResponse({ success: false, error: err.message }, 500);
  }
});

type SellFailureKind = "rate_limit" | "no_route" | "no_tokens" | "other";

type WalletTokenContext = {
  decimals: number;
  rawBalance: number;
  tokenBalance: number;
};

type SellAttemptResult = {
  success: boolean;
  txSignature?: string | null;
  soldTokenAmount?: number | null;
  tokenDecimals?: number;
  soldRawAmount?: number;
  remainingRawBalance?: number;
  error?: string;
};

type RecentSellStats = {
  rateLimitCount: number;
  noRouteCount: number;
  noTokensCount: number;
  lastRateLimitAt: number | null;
  lastNoRouteAt: number | null;
};

function classifySellError(message?: string): SellFailureKind {
  const normalized = (message || "").toLowerCase();
  if (normalized.includes("rate limit")) return "rate_limit";
  if (normalized.includes("no routes found") || normalized.includes("no route")) return "no_route";
  if (normalized.includes("brak tokenów") || normalized.includes("no tokens") || normalized.includes("insufficient")) return "no_tokens";
  return "other";
}

function getRpcUrl(): string {
  const heliusKey = Deno.env.get("HELIUS_API_KEY");
  return heliusKey
    ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
    : SOLANA_RPC_DEFAULT;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updatePositionSnapshot(
  supabase: any,
  pos: any,
  currentPrice: number,
  highestPrice: number,
  pnlPct: number,
) {
  await supabase.from("open_positions").update({
    current_price_usd: currentPrice,
    highest_price_usd: highestPrice,
    pnl_pct: Math.round(pnlPct * 100) / 100,
    updated_at: new Date().toISOString(),
  }).eq("id", pos.id);
}

async function getRecentSellStats(supabase: any, tokenMint: string): Promise<RecentSellStats> {
  const since = new Date(Date.now() - SELL_FAILURE_LOOKBACK_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("trade_executions")
    .select("created_at,error_message,status")
    .eq("action", "SELL")
    .eq("token_mint", tokenMint)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error || !data) {
    if (error) console.warn(`[position-monitor] Failed loading recent SELL stats for ${tokenMint}:`, error);
    return {
      rateLimitCount: 0,
      noRouteCount: 0,
      noTokensCount: 0,
      lastRateLimitAt: null,
      lastNoRouteAt: null,
    };
  }

  const stats: RecentSellStats = {
    rateLimitCount: 0,
    noRouteCount: 0,
    noTokensCount: 0,
    lastRateLimitAt: null,
    lastNoRouteAt: null,
  };

  for (const row of data) {
    if (row.status !== "failed") continue;
    const kind = classifySellError(row.error_message || "");
    const createdAt = row.created_at ? new Date(row.created_at).getTime() : null;

    if (kind === "rate_limit") {
      stats.rateLimitCount += 1;
      if (!stats.lastRateLimitAt && createdAt) stats.lastRateLimitAt = createdAt;
    }

    if (kind === "no_route") {
      stats.noRouteCount += 1;
      if (!stats.lastNoRouteAt && createdAt) stats.lastNoRouteAt = createdAt;
    }

    if (kind === "no_tokens") {
      stats.noTokensCount += 1;
    }
  }

  return stats;
}

function shouldPauseSell(stats: RecentSellStats): string | null {
  const now = Date.now();

  if (stats.lastRateLimitAt && now - stats.lastRateLimitAt < SELL_RATE_LIMIT_COOLDOWN_MS) {
    return "rate_limit_cooldown";
  }

  if (
    stats.noRouteCount >= 2 &&
    stats.lastNoRouteAt &&
    now - stats.lastNoRouteAt < SELL_NO_ROUTE_COOLDOWN_MS
  ) {
    return "no_route_cooldown";
  }

  return null;
}

async function fetchTokenDecimals(rpcUrl: string, mint: string): Promise<number> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenSupply",
        params: [mint],
      }),
    });
    const data = await res.json();
    const decimals = Number(data?.result?.value?.decimals);
    return Number.isFinite(decimals) ? decimals : 6;
  } catch {
    return 6;
  }
}

async function fetchWalletTokenBalanceBaseUnits(rpcUrl: string, owner: string, mint: string): Promise<number> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          owner,
          { mint },
          { encoding: "jsonParsed" },
        ],
      }),
    });

    const data = await res.json();
    const accounts = data?.result?.value || [];

    return accounts.reduce((sum: number, acc: any) => {
      const rawAmount = Number(acc?.account?.data?.parsed?.info?.tokenAmount?.amount || 0);
      return sum + (Number.isFinite(rawAmount) ? rawAmount : 0);
    }, 0);
  } catch {
    return 0;
  }
}

async function fetchWalletTokenContext(tokenMint: string): Promise<WalletTokenContext | null> {
  const owner = Deno.env.get("SOLANA_PUBLIC_KEY");
  if (!owner) return null;

  const rpcUrl = getRpcUrl();
  const [decimals, rawBalance] = await Promise.all([
    fetchTokenDecimals(rpcUrl, tokenMint),
    fetchWalletTokenBalanceBaseUnits(rpcUrl, owner, tokenMint),
  ]);

  return {
    decimals,
    rawBalance,
    tokenBalance: rawBalance / Math.pow(10, decimals),
  };
}

async function executeSellWithRetries(
  supabaseUrl: string,
  supabaseKey: string,
  pos: any,
): Promise<SellAttemptResult> {
  let lastError = "SELL execution failed";

  for (let attempt = 0; attempt < SELL_SLIPPAGE_STEPS.length; attempt++) {
    const slippageBps = SELL_SLIPPAGE_STEPS[attempt];

    try {
      const swapRes = await fetch(`${supabaseUrl}/functions/v1/execute-swap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          action: "SELL",
          tokenMint: pos.token_mint,
          amountSol: pos.token_amount || pos.amount_sol,
          closeAll: true,
          slippageBps,
        }),
      });

      const swapData = await swapRes.json().catch(() => null);
      if (swapRes.ok && swapData?.success && swapData?.txSignature) {
        return {
          success: true,
          txSignature: swapData.txSignature,
          soldTokenAmount: typeof swapData?.soldRawAmount === "number" && typeof swapData?.tokenDecimals === "number"
            ? swapData.soldRawAmount / Math.pow(10, swapData.tokenDecimals)
            : Number(pos.token_amount) || null,
          tokenDecimals: swapData?.tokenDecimals,
          soldRawAmount: swapData?.soldRawAmount,
          remainingRawBalance: swapData?.remainingRawBalance,
        };
      }

      lastError = swapData?.error || `HTTP ${swapRes.status}: SELL execution failed`;
      const kind = classifySellError(lastError);

      if (kind === "rate_limit" && attempt < SELL_SLIPPAGE_STEPS.length - 1) {
        await delay(1200 * (attempt + 1));
        continue;
      }

      if (kind === "other" && attempt < 1) {
        await delay(800);
        continue;
      }

      break;
    } catch (err: any) {
      lastError = err?.message || "SELL execution failed";
      if (classifySellError(lastError) === "rate_limit" && attempt < SELL_SLIPPAGE_STEPS.length - 1) {
        await delay(1200 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  return { success: false, error: lastError };
}

// ── UNIFIED CLOSE POSITION ──
async function closePosition(
  supabase: any, supabaseUrl: string, supabaseKey: string,
  pos: any, currentPrice: number, closeReason: string, pnlPct: number
): Promise<boolean> {
  const entryPrice = Number(pos.entry_price_usd) || 0;
  const highestPrice = Math.max(Number(pos.highest_price_usd) || 0, currentPrice);
  const pnlSol = (pnlPct / 100) * Number(pos.amount_sol);
  const recordedTokenAmount = Number(pos.token_amount) || 0;

  let txSignature: string | null = null;
  let soldTokenAmount = recordedTokenAmount || null;

  const recentSellStats = await getRecentSellStats(supabase, pos.token_mint);
  const pauseReason = shouldPauseSell(recentSellStats);

  if (pauseReason) {
    console.warn(`[position-monitor] SELL paused for ${pos.token_symbol}: ${pauseReason}`);
    await updatePositionSnapshot(supabase, pos, currentPrice, highestPrice, pnlPct);
    return false;
  }

  const marketPnlPct = entryPrice > 0 && currentPrice > 0
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : pnlPct;
  // ── RACE CONDITION FIX: preserve original closeReason when tokens already sold ──
  const originalCloseReason = closeReason;
  const walletContextBefore = await fetchWalletTokenContext(pos.token_mint);
  if (walletContextBefore && walletContextBefore.rawBalance <= 0) {
    // Tokens already gone (sold by previous cycle or externally)
    // Preserve the ORIGINAL close reason instead of overwriting to "no_tokens"
    console.warn(`[position-monitor] No tokens in wallet for ${pos.token_symbol} before SELL — closing as ${originalCloseReason} (tokens already sold)`);
    if (originalCloseReason === "no_tokens" || !originalCloseReason) {
      closeReason = "no_tokens";
    }
    // else keep originalCloseReason (time_decay, stop_loss, trailing_stop etc.)
    pnlPct = marketPnlPct;
  } else {
    try {
      const sellResult = await executeSellWithRetries(supabaseUrl, supabaseKey, pos);
      if (!sellResult.success || !sellResult.txSignature) {
        throw new Error(sellResult.error || "SELL execution failed");
      }

      txSignature = sellResult.txSignature;
      soldTokenAmount = sellResult.soldTokenAmount ?? soldTokenAmount;

      const { error: executionInsertError } = await supabase.from("trade_executions").insert({
        signal_id: pos.signal_id || null,
        action: "SELL",
        token_mint: pos.token_mint,
        token_symbol: pos.token_symbol,
        amount_sol: Number(pos.amount_sol) || 0,
        token_amount: soldTokenAmount,
        price_usd: currentPrice,
        tx_signature: txSignature,
        status: "executed",
      });

      if (executionInsertError) {
        console.error(`[position-monitor] Failed to insert SELL execution for ${pos.token_symbol}:`, executionInsertError);
      }
    } catch (sellErr: any) {
      console.error(`Sell error for ${pos.token_symbol}:`, sellErr);
      const errMsg = sellErr.message || "";
      const sellErrorKind = classifySellError(errMsg);
      const walletContextAfter = await fetchWalletTokenContext(pos.token_mint) || walletContextBefore;
      const walletTokenBalance = walletContextAfter?.tokenBalance || 0;
      const dustRawThreshold = walletContextAfter
        ? Math.max(1, Math.floor(Math.pow(10, Math.max(walletContextAfter.decimals - 2, 0))))
        : 1;
      const walletRatio = recordedTokenAmount > 0 ? walletTokenBalance / recordedTokenAmount : 0;
      const estimatedNotionalUsd = walletTokenBalance * currentPrice;
      const shouldCloseAsDust = Boolean(
        walletContextAfter &&
        sellErrorKind === "no_route" &&
        recentSellStats.noRouteCount + 1 >= MAX_NO_ROUTE_ATTEMPTS_BEFORE_DUST_CLOSE &&
        (
          walletContextAfter.rawBalance <= dustRawThreshold ||
          estimatedNotionalUsd <= DUST_VALUE_USD_THRESHOLD ||
          walletRatio <= DUST_TOKEN_RATIO_THRESHOLD
        )
      );

      const enrichedError = [
        errMsg.slice(0, 300),
        walletContextAfter ? `wallet_balance=${walletTokenBalance}` : null,
        Number.isFinite(estimatedNotionalUsd) ? `wallet_value_usd=${estimatedNotionalUsd}` : null,
      ].filter(Boolean).join(" | ");

      const { error: executionInsertError } = await supabase.from("trade_executions").insert({
        signal_id: pos.signal_id || null,
        action: "SELL",
        token_mint: pos.token_mint,
        token_symbol: pos.token_symbol,
        amount_sol: Number(pos.amount_sol) || 0,
        token_amount: walletTokenBalance || Number(pos.token_amount) || null,
        price_usd: currentPrice,
        tx_signature: txSignature,
        status: "failed",
        error_message: enrichedError.slice(0, 500),
      });

      if (executionInsertError) {
        console.error(`[position-monitor] Failed to insert failed SELL execution for ${pos.token_symbol}:`, executionInsertError);
      }

      if (sellErrorKind === "no_tokens" || (walletContextAfter && walletContextAfter.rawBalance <= 0)) {
        console.warn(`[position-monitor] No tokens left for ${pos.token_symbol} — closing as ${originalCloseReason} (tokens gone after sell attempt)`);
        txSignature = null;
        // Preserve original reason if it was a legitimate exit
        if (!originalCloseReason || originalCloseReason === "no_tokens") {
          closeReason = "no_tokens";
        }
        pnlPct = marketPnlPct;
      } else if (shouldCloseAsDust) {
        console.warn(`[position-monitor] Closing ${pos.token_symbol} as unsellable_dust after repeated no-route errors`);
        txSignature = null;
        closeReason = "unsellable_dust";
        soldTokenAmount = walletTokenBalance;
        pnlPct = marketPnlPct;
      } else {
        await updatePositionSnapshot(supabase, pos, currentPrice, highestPrice, pnlPct);

        if (sellErrorKind !== "rate_limit" || !recentSellStats.lastRateLimitAt) {
          await supabase.from("notifications").insert({
            type: "swap_error",
            title: `❌ Sprzedaż nieudana: ${pos.token_symbol}`,
            message: `Bot nie zamknął pozycji, bo swap SELL nie przeszedł. Powód: ${errMsg.slice(0, 140)}`,
            details: {
              position_id: pos.id,
              token_mint: pos.token_mint,
              close_reason: closeReason,
              error: errMsg,
              wallet_balance: walletTokenBalance,
              wallet_value_usd: estimatedNotionalUsd,
            },
          });
        }

        return false;
      }
    }
  }

  await supabase.from("open_positions").update({
    status: "closed",
    close_reason: closeReason,
    current_price_usd: currentPrice,
    highest_price_usd: highestPrice,
    pnl_pct: Math.round(Math.max(-100, Math.min(pnlPct, 100)) * 100) / 100,
    closed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", pos.id);

  const reasonLabels: Record<string, string> = {
    stop_loss: "🔴 Stop-Loss (-12%)",
    trailing_stop: "🟡 Trailing Stop",
    take_profit: "🟢 Take-Profit",
    dead_token: "💀 Dead Token",
    no_tokens: "🔻 Brak tokenów w portfelu",
    unsellable_dust: "🧹 Unsellable Dust Cleanup",
    profit_fade: "🟠 Profit Fade Lock",
    fast_loss_cut: "⚡ Fast Loss Cut",
    time_decay: "⏰ Time Decay (180min)",
    max_hold_time: "⏳ Max Hold (3h)",
    mini_profit_take: "💰 Mini Profit Take",
  };
  await supabase.from("notifications").insert({
    type: "position_closed",
    title: `${reasonLabels[closeReason] || closeReason} — ${pos.token_symbol || "???"}`,
    message: `PnL: ${pnlPct.toFixed(1)}% | Entry: $${entryPrice.toFixed(8)} | Exit: $${currentPrice.toFixed(8)}${txSignature ? ` | TX: ${txSignature.slice(0, 12)}...` : ""}`,
    details: {
      position_id: pos.id,
      token_mint: pos.token_mint,
      close_reason: closeReason,
      pnl_pct: pnlPct,
      entry_price: entryPrice,
      exit_price: currentPrice,
      highest_price: highestPrice,
      tx: txSignature,
      sold_token_amount: soldTokenAmount,
    },
  });

  try {
    const { data: profile } = await supabase.from("profiles").select("id").limit(1).single();
    if (profile) {
      await supabase.from("journal_entries").insert({
        user_id: profile.id,
        entry_type: "auto",
        title: `${reasonLabels[closeReason] || closeReason}: ${pos.token_symbol || "???"}`,
        notes: `${closeReason} | Entry: $${entryPrice.toFixed(8)}, Exit: $${currentPrice.toFixed(8)}. PnL: ${pnlPct.toFixed(2)}%.${txSignature ? ` TX: ${txSignature}` : ""}`,
        token_symbol: pos.token_symbol,
        token_mint: pos.token_mint,
        action: "SELL",
        amount_sol: Number(pos.amount_sol),
        pnl_sol: Math.round(pnlSol * 10000) / 10000,
        pnl_pct: Math.round(pnlPct * 100) / 100,
        position_id: pos.id,
        tags: ["auto", "bot", closeReason],
      });
    }
  } catch (jErr) {
    console.warn("Journal error:", jErr);
  }

  return true;
}

// ── PRICE FETCHER ──
async function fetchTokenPrices(mints: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  if (mints.length === 0) return prices;

  try {
    const ids = encodeURIComponent(mints.join(","));
    const priceRes = await fetch(`https://lite-api.jup.ag/price/v2?ids=${ids}`);
    if (priceRes.ok) {
      const priceData = await priceRes.json();
      for (const [mint, info] of Object.entries(priceData?.data || {})) {
        const p = Number((info as any)?.price);
        if (Number.isFinite(p) && p > 0) prices[mint] = p;
      }
    }
  } catch (e) {
    console.error("Jupiter price fetch error:", e);
  }

  const missing = mints.filter((mint) => !prices[mint]);
  await Promise.all(
    missing.map(async (mint) => {
      try {
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
        if (!dexRes.ok) return;
        const dexData = await dexRes.json();
        const pairs = Array.isArray(dexData?.pairs) ? dexData.pairs : [];
        const validPairs = pairs
          .filter((p: any) => Number(p?.priceUsd) > 0)
          .sort((a: any, b: any) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
        const dexPrice = Number(validPairs[0]?.priceUsd);
        if (Number.isFinite(dexPrice) && dexPrice > 0) prices[mint] = dexPrice;
      } catch (_) {}
    })
  );

  return prices;
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
