import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HELIUS_RPC = "https://mainnet.helius-rpc.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const heliusKey = Deno.env.get("HELIUS_API_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Get all open positions
    const { data: positions, error: posErr } = await supabase
      .from("open_positions")
      .select("*")
      .eq("status", "open");

    if (posErr) throw posErr;
    if (!positions || positions.length === 0) {
      return jsonResponse({ success: true, message: "No open positions", checked: 0, closed: 0 });
    }

    // 2. Get current prices for all tokens (Jupiter Lite + DexScreener fallback)
    const mints = [...new Set(positions.map((p: any) => p.token_mint))];
    const priceMap = await fetchTokenPrices(mints);

    let closedCount = 0;
    const updates: any[] = [];

    for (const pos of positions) {
      const currentPrice = priceMap[pos.token_mint] || 0;
      if (currentPrice <= 0) continue;

      const trailingStopPct = Number(pos.trailing_stop_pct) || 10;
      const takeProfitPct = Number(pos.take_profit_pct) || 50;

      let entryPrice = Number(pos.entry_price_usd) || 0;
      if (entryPrice <= 0) {
        const highestPriceSeed = Math.max(Number(pos.highest_price_usd) || 0, currentPrice);
        const seededStopPrice = highestPriceSeed * (1 - trailingStopPct / 100);

        await supabase.from("open_positions").update({
          entry_price_usd: currentPrice,
          current_price_usd: currentPrice,
          highest_price_usd: highestPriceSeed,
          stop_price_usd: seededStopPrice,
          pnl_pct: 0,
          updated_at: new Date().toISOString(),
        }).eq("id", pos.id);

        continue;
      }

      const highestPrice = Math.max(Number(pos.highest_price_usd) || 0, currentPrice);
      const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;

      // Trailing stop price = highest price * (1 - trailing%)
      const stopPrice = highestPrice * (1 - trailingStopPct / 100);

      // Check conditions
      let closeReason: string | null = null;

      if (currentPrice <= stopPrice && pnlPct < 0) {
        closeReason = "stop_loss";
      } else if (currentPrice <= stopPrice && pnlPct >= 0) {
        closeReason = "trailing_stop";
      }

      if (pnlPct >= takeProfitPct) {
        closeReason = "take_profit";
      }

      if (closeReason) {
        // Execute SELL
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
              slippageBps: 200,
            }),
          });
          const swapData = await swapRes.json();

          // Close position
          await supabase.from("open_positions").update({
            status: "closed",
            close_reason: closeReason,
            current_price_usd: currentPrice,
            highest_price_usd: highestPrice,
            stop_price_usd: stopPrice,
            pnl_pct: Math.round(pnlPct * 100) / 100,
            closed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", pos.id);

          // Notify
          const reasonLabels: Record<string, string> = {
            stop_loss: "🔴 Stop-Loss",
            trailing_stop: "🟡 Trailing Stop",
            take_profit: "🟢 Take-Profit",
          };
          await supabase.from("notifications").insert({
            type: "position_closed",
            title: `${reasonLabels[closeReason]} — ${pos.token_symbol || "???"}`,
            message: `Pozycja zamknięta: ${closeReason}. PnL: ${pnlPct.toFixed(1)}%. Cena: $${currentPrice.toFixed(6)}`,
            details: {
              position_id: pos.id,
              token_mint: pos.token_mint,
              close_reason: closeReason,
              pnl_pct: pnlPct,
              entry_price: entryPrice,
              exit_price: currentPrice,
              highest_price: highestPrice,
              tx: swapData?.txSignature || null,
            },
          });

          closedCount++;
        } catch (sellErr: any) {
          console.error(`Sell error for ${pos.token_symbol}:`, sellErr);
          await supabase.from("notifications").insert({
            type: "swap_error",
            title: `❌ Błąd zamknięcia: ${pos.token_symbol}`,
            message: `Nie udało się zamknąć pozycji (${closeReason}): ${sellErr.message?.slice(0, 100)}`,
            details: { position_id: pos.id, error: sellErr.message },
          });
        }
      } else {
        // Just update tracking data
        await supabase.from("open_positions").update({
          current_price_usd: currentPrice,
          highest_price_usd: highestPrice,
          stop_price_usd: stopPrice,
          pnl_pct: Math.round(pnlPct * 100) / 100,
          updated_at: new Date().toISOString(),
        }).eq("id", pos.id);
      }
    }

    return jsonResponse({
      success: true,
      checked: positions.length,
      closed: closedCount,
      prices_fetched: Object.keys(priceMap).length,
    });
  } catch (err: any) {
    console.error("Position monitor error:", err);
    return jsonResponse({ success: false, error: err.message }, 500);
  }
});

async function fetchTokenPrices(mints: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  if (mints.length === 0) return prices;

  // 1) Jupiter Lite
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

  // 2) DexScreener fallback for missing mints
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
        if (Number.isFinite(dexPrice) && dexPrice > 0) {
          prices[mint] = dexPrice;
        }
      } catch (_) {
        // ignore individual token fallback errors
      }
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
