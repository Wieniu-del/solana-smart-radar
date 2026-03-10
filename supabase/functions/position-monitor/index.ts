import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    let closedCount = 0;

    for (const pos of positions) {
      const currentPrice = priceMap[pos.token_mint] || 0;

      // ── DEAD TOKEN: brak ceny przez >3h → zamknij (skrócone z 6h) ──
      if (currentPrice <= 0) {
        const lastUpdate = new Date(pos.updated_at).getTime();
        const hoursSinceUpdate = (Date.now() - lastUpdate) / (1000 * 60 * 60);
        const entryPrice = Number(pos.entry_price_usd) || 0;

        if (hoursSinceUpdate >= 3 || entryPrice <= 0) {
          console.warn(`[position-monitor] Dead token: ${pos.token_symbol} — no price ${hoursSinceUpdate.toFixed(1)}h, force-closing`);
          await closePosition(supabase, supabaseUrl, supabaseKey, pos, 0, "dead_token", -100);
          closedCount++;
          continue;
        }
        console.warn(`[position-monitor] No price for ${pos.token_symbol}, waiting ${(3 - hoursSinceUpdate).toFixed(1)}h`);
        continue;
      }

      let entryPrice = Number(pos.entry_price_usd) || 0;
      if (entryPrice <= 0) {
        // Seed entry price
        await supabase.from("open_positions").update({
          entry_price_usd: currentPrice,
          current_price_usd: currentPrice,
          highest_price_usd: currentPrice,
          stop_price_usd: currentPrice * 0.93,
          pnl_pct: 0,
          updated_at: new Date().toISOString(),
        }).eq("id", pos.id);
        continue;
      }

      const highestPrice = Math.max(Number(pos.highest_price_usd) || 0, currentPrice);
      const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
      const hoursHeld = (Date.now() - new Date(pos.opened_at).getTime()) / (1000 * 60 * 60);
      const baseTrailingStopPct = Number(pos.trailing_stop_pct) || 7;
      const takeProfitPct = Number(pos.take_profit_pct) || 12;

      // ── AGGRESSIVE DYNAMIC TRAILING STOP ──
      let trailingStopPct = baseTrailingStopPct;
      if (pnlPct >= 15 && hoursHeld < 1) {
        trailingStopPct = 3; // Rocket: lock hard
      } else if (pnlPct >= 10 && hoursHeld < 2) {
        trailingStopPct = 4;
      } else if (pnlPct >= 8) {
        trailingStopPct = 5;
      } else if (pnlPct >= 5) {
        trailingStopPct = 6;
      }

      const stopPrice = highestPrice * (1 - trailingStopPct / 100);

      // ── EARLY PROFIT LOCK: jeśli zysk spadł z >5% do <2% → zamknij (oddajemy zyski!) ──
      const prevHighPnl = ((highestPrice - entryPrice) / entryPrice) * 100;
      if (prevHighPnl >= 5 && pnlPct < 2 && pnlPct >= 0) {
        console.warn(`[position-monitor] Profit fade: ${pos.token_symbol} was +${prevHighPnl.toFixed(1)}% now +${pnlPct.toFixed(1)}% — locking gains`);
        await closePosition(supabase, supabaseUrl, supabaseKey, pos, currentPrice, "profit_fade", pnlPct);
        closedCount++;
        continue;
      }

      // ── CHECK CLOSE CONDITIONS ──
      let closeReason: string | null = null;

      if (currentPrice <= stopPrice && pnlPct < 0) {
        closeReason = "stop_loss";
      } else if (currentPrice <= stopPrice && pnlPct >= 0) {
        closeReason = "trailing_stop";
      }

      if (pnlPct >= takeProfitPct) {
        closeReason = "take_profit";
      }

      // ── FAST LOSS CUT: jeśli -5% w pierwszych 30min → od razu tnij ──
      if (pnlPct <= -5 && hoursHeld < 0.5) {
        closeReason = "fast_loss_cut";
      }

      // ── TIME-BASED DECAY: po 4h z zyskiem <3% → zamknij (nie warto trzymać) ──
      if (hoursHeld >= 4 && pnlPct < 3 && pnlPct > -3) {
        closeReason = "time_decay";
      }

      if (closeReason) {
        await closePosition(supabase, supabaseUrl, supabaseKey, pos, currentPrice, closeReason, pnlPct);
        closedCount++;
      } else {
        // Update tracking
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
) {
  const entryPrice = Number(pos.entry_price_usd) || 0;
  const highestPrice = Math.max(Number(pos.highest_price_usd) || 0, currentPrice);
  const pnlSol = (pnlPct / 100) * Number(pos.amount_sol);

  // Try to execute SELL (skip for dead tokens with no price)
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
          slippageBps: 300, // Higher slippage for faster exits
        }),
      });
      const swapData = await swapRes.json();
      txSignature = swapData?.txSignature || null;
    } catch (sellErr: any) {
      console.error(`Sell error for ${pos.token_symbol}:`, sellErr);
      await supabase.from("notifications").insert({
        type: "swap_error",
        title: `❌ Błąd sprzedaży: ${pos.token_symbol}`,
        message: `Nie udało się sprzedać (${closeReason}): ${sellErr.message?.slice(0, 100)}`,
        details: { position_id: pos.id, error: sellErr.message },
      });
    }
  }

  // Close position in DB
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
    stop_loss: "🔴 Stop-Loss",
    trailing_stop: "🟡 Trailing Stop",
    take_profit: "🟢 Take-Profit",
    dead_token: "💀 Dead Token",
    profit_fade: "🟠 Profit Fade Lock",
    fast_loss_cut: "⚡ Fast Loss Cut",
    time_decay: "⏰ Time Decay",
    stale_position: "⏸️ Stale",
  };
  await supabase.from("notifications").insert({
    type: "position_closed",
    title: `${reasonLabels[closeReason] || closeReason} — ${pos.token_symbol || "???"}`,
    message: `PnL: ${pnlPct.toFixed(1)}% | Entry: $${entryPrice.toFixed(8)} | Exit: $${currentPrice.toFixed(8)}`,
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
        notes: `${closeReason} | Entry: $${entryPrice.toFixed(8)}, Exit: $${currentPrice.toFixed(8)}. PnL: ${pnlPct.toFixed(2)}%`,
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
}

// ── PRICE FETCHER ──
async function fetchTokenPrices(mints: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  if (mints.length === 0) return prices;

  // Jupiter Lite
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

  // DexScreener fallback
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
