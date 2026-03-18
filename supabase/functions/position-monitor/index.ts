import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── TRAILING STOP TABLE ───
const TRAILING_TABLE = [
  { minPnl: 200, trailing: 5 },
  { minPnl: 100, trailing: 4 },
  { minPnl: 80, trailing: 2 },
  { minPnl: 40, trailing: 2.5 },
  { minPnl: 20, trailing: 3 },
  { minPnl: 10, trailing: 3.5 },
  { minPnl: 0, trailing: 4 },
];

function getTrailingStopPct(pnlPct: number): number {
  for (const tier of TRAILING_TABLE) {
    if (pnlPct >= tier.minPnl) return tier.trailing;
  }
  return 4;
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
    const TRAILING_START_PCT = Number(trailingStartConfig?.value) || 8;

    let closedCount = 0;

    for (const pos of positions) {
      const currentPrice = priceMap[pos.token_mint] || 0;
      console.log(`[position-monitor] ${pos.token_symbol}: entry=$${Number(pos.entry_price_usd).toFixed(6)}, current=$${currentPrice.toFixed(6)}, pnl=${currentPrice > 0 && Number(pos.entry_price_usd) > 0 ? (((currentPrice - Number(pos.entry_price_usd)) / Number(pos.entry_price_usd)) * 100).toFixed(2) : '?'}%`);

      // ── DEAD TOKEN: no price for >3h → close ──
      if (currentPrice <= 0) {
        const lastUpdate = new Date(pos.updated_at).getTime();
        const hoursSinceUpdate = (Date.now() - lastUpdate) / (1000 * 60 * 60);
        const entryPrice = Number(pos.entry_price_usd) || 0;

        if (hoursSinceUpdate >= 3 || entryPrice <= 0) {
          console.warn(`[position-monitor] Dead token: ${pos.token_symbol} — no price ${hoursSinceUpdate.toFixed(1)}h, force-closing as -100%`);
          const closed = await closePosition(supabase, supabaseUrl, supabaseKey, pos, 0, "dead_token", -100);
          if (closed) closedCount++;
          continue;
        }
        console.warn(`[position-monitor] No price for ${pos.token_symbol}, waiting ${(3 - hoursSinceUpdate).toFixed(1)}h`);
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

      // ── DYNAMIC TRAILING STOP from table ──
      // Only activate trailing if pnl >= trailing start threshold (8%)
      const trailingActive = pnlPct >= TRAILING_START_PCT;
      const trailingStopPct = getTrailingStopPct(pnlPct);
      const stopPrice = trailingActive
        ? highestPrice * (1 - trailingStopPct / 100)
        : entryPrice * (1 - STOP_LOSS_PCT / 100); // hard SL before trailing activates

      // ── EARLY PROFIT LOCK: profit faded from >3% to <1% → lock ──
      const prevHighPnl = ((highestPrice - entryPrice) / entryPrice) * 100;
      if (prevHighPnl >= 3 && pnlPct < 1 && pnlPct >= 0) {
        console.warn(`[position-monitor] Profit fade: ${pos.token_symbol} was +${prevHighPnl.toFixed(1)}% now +${pnlPct.toFixed(1)}% — locking gains`);
        const closed = await closePosition(supabase, supabaseUrl, supabaseKey, pos, currentPrice, "profit_fade", pnlPct);
        if (closed) closedCount++;
        continue;
      }

      // ── CHECK CLOSE CONDITIONS ──
      let closeReason: string | null = null;

      // Hard stop loss at -15%
      if (pnlPct <= -STOP_LOSS_PCT) {
        closeReason = "stop_loss";
      }
      // Trailing stop hit (only when trailing is active)
      else if (trailingActive && currentPrice <= stopPrice) {
        closeReason = "trailing_stop";
      }

      // ── FAST LOSS CUT: -5% in first 30min ──
      if (pnlPct <= -5 && hoursHeld < 0.5) {
        closeReason = "fast_loss_cut";
      }

      // ── TIME DECAY: after 1.5h with <5% profit → close (no hodling) ──
      // SKIP if mega-winner (PnL > 100%) — let trailing stop manage it
      if (hoursHeld >= 1.5 && pnlPct < 5 && pnlPct > -STOP_LOSS_PCT) {
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

// ── UNIFIED CLOSE POSITION ──
async function closePosition(
  supabase: any, supabaseUrl: string, supabaseKey: string,
  pos: any, currentPrice: number, closeReason: string, pnlPct: number
): Promise<boolean> {
  const entryPrice = Number(pos.entry_price_usd) || 0;
  const highestPrice = Math.max(Number(pos.highest_price_usd) || 0, currentPrice);
  const pnlSol = (pnlPct / 100) * Number(pos.amount_sol);

  // Try to execute SELL first (for non-dead tokens)
  let txSignature: string | null = null;
  if (currentPrice > 0 && closeReason !== "dead_token") {
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
          slippageBps: 300,
        }),
      });

      if (!swapRes.ok) {
        const errText = await swapRes.text();
        throw new Error(`HTTP ${swapRes.status}: ${errText.slice(0, 160)}`);
      }

      const swapData = await swapRes.json();
      if (!swapData?.success || !swapData?.txSignature) {
        throw new Error(swapData?.error || "Swap SELL failed (no tx signature)");
      }

      txSignature = swapData.txSignature;

      await supabase.from("trade_executions").insert({
        signal_id: pos.signal_id || null,
        action: "SELL",
        token_mint: pos.token_mint,
        token_symbol: pos.token_symbol,
        amount_sol: Number(pos.amount_sol) || 0,
        token_amount: Number(pos.token_amount) || null,
        price_usd: currentPrice,
        tx_signature: txSignature,
        status: "executed",
      });
    } catch (sellErr: any) {
      console.error(`Sell error for ${pos.token_symbol}:`, sellErr);
      const errMsg = sellErr.message || "";

      // If wallet has no tokens — force-close position (nothing to sell)
      const noTokens = errMsg.includes("Brak tokenów") || errMsg.includes("no tokens") || errMsg.includes("insufficient");
      if (noTokens) {
        console.warn(`[position-monitor] No tokens in wallet for ${pos.token_symbol} — force-closing as no_tokens`);
        // Don't return false — fall through to close the position in DB
        txSignature = null;
        closeReason = "no_tokens";
        // Recalculate pnl as -100% since tokens are gone
        pnlPct = -100;
      } else {
        // Retriable error — keep position open
        await supabase.from("open_positions").update({
          current_price_usd: currentPrice,
          highest_price_usd: highestPrice,
          pnl_pct: Math.round(pnlPct * 100) / 100,
          updated_at: new Date().toISOString(),
        }).eq("id", pos.id);

        await supabase.from("notifications").insert({
          type: "swap_error",
          title: `❌ Sprzedaż nieudana: ${pos.token_symbol}`,
          message: `Nie zamknięto pozycji (${closeReason}) — ponowię próbę przy kolejnym skanie. ${errMsg.slice(0, 120)}`,
          details: { position_id: pos.id, token_mint: pos.token_mint, close_reason: closeReason, error: errMsg },
        });

        return false;
      }
    }
  }

  // Close position in DB only after SELL success (or dead token force-close)
  await supabase.from("open_positions").update({
    status: "closed",
    close_reason: closeReason,
    current_price_usd: currentPrice,
    highest_price_usd: highestPrice,
    pnl_pct: Math.round(pnlPct * 100) / 100,
    closed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", pos.id);

  // Notification
  const reasonLabels: Record<string, string> = {
    stop_loss: "🔴 Stop-Loss (-15%)",
    trailing_stop: "🟡 Trailing Stop",
    take_profit: "🟢 Take-Profit",
    dead_token: "💀 Dead Token",
    no_tokens: "🔻 Brak tokenów w portfelu",
    profit_fade: "🟠 Profit Fade Lock",
    fast_loss_cut: "⚡ Fast Loss Cut",
    time_decay: "⏰ Time Decay (1.5h)",
    max_hold_time: "⏳ Max Hold (3h)",
  };
  await supabase.from("notifications").insert({
    type: "position_closed",
    title: `${reasonLabels[closeReason] || closeReason} — ${pos.token_symbol || "???"}`,
    message: `PnL: ${pnlPct.toFixed(1)}% | Entry: $${entryPrice.toFixed(8)} | Exit: $${currentPrice.toFixed(8)}${txSignature ? ` | TX: ${txSignature.slice(0, 12)}...` : ""}`,
    details: {
      position_id: pos.id, token_mint: pos.token_mint,
      close_reason: closeReason, pnl_pct: pnlPct,
      entry_price: entryPrice, exit_price: currentPrice,
      highest_price: highestPrice, tx: txSignature,
    },
  });

  // Journal entry
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
