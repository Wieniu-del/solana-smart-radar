import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HELIUS_BASE = "https://api.helius.xyz/v0";
const HELIUS_RPC = "https://mainnet.helius-rpc.com";

const BASE_ASSET_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

// Jupiter V6 program ID
const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const heliusKey = Deno.env.get("HELIUS_API_KEY");
  if (!heliusKey) {
    return jsonResponse({ success: false, error: "HELIUS_API_KEY not set" }, 500);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Step 1: Get recent Jupiter swap signatures
    console.log("[find-wallets] Fetching recent Jupiter swap signatures...");
    const sigRes = await fetch(`${HELIUS_RPC}/?api-key=${heliusKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [JUPITER_PROGRAM, { limit: 100 }],
      }),
    });

    if (!sigRes.ok) {
      const err = await sigRes.text();
      return jsonResponse({ success: false, error: `Signatures fetch failed: ${err}` }, 502);
    }

    const sigJson = await sigRes.json();
    const allSigs = (sigJson.result || []).map((s: any) => s.signature);
    console.log(`[find-wallets] Got ${allSigs.length} signatures`);

    if (allSigs.length === 0) {
      return jsonResponse({ success: true, discovered: 0, candidates: [], total_analyzed: 0, reason: "No recent Jupiter signatures" });
    }

    // Step 2: Parse transactions in batches of 20
    const walletActivity: Record<string, { buys: number; tokens: Set<string>; solSpent: number }> = {};
    
    const batches: string[][] = [];
    for (let i = 0; i < Math.min(allSigs.length, 60); i += 20) {
      batches.push(allSigs.slice(i, i + 20));
    }

    for (const batch of batches) {
      try {
        const parseRes = await fetch(`${HELIUS_BASE}/transactions?api-key=${heliusKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: batch }),
        });

        if (!parseRes.ok) {
          console.error("[find-wallets] Parse batch failed:", parseRes.status);
          continue;
        }

        const parsedTxns = await parseRes.json();
        console.log(`[find-wallets] Parsed ${parsedTxns.length} transactions`);

        for (const tx of parsedTxns) {
          if (!tx?.feePayer) continue;
          const wallet = tx.feePayer;
          const transfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];

          for (const t of transfers) {
            if (t.toUserAccount === wallet && t.mint && !BASE_ASSET_MINTS.has(t.mint)) {
              if (!walletActivity[wallet]) {
                walletActivity[wallet] = { buys: 0, tokens: new Set(), solSpent: 0 };
              }
              walletActivity[wallet].buys++;
              walletActivity[wallet].tokens.add(t.mint);
            }
          }

          // Track SOL spent
          if (walletActivity[wallet]) {
            const nativeTransfers = Array.isArray(tx.nativeTransfers) ? tx.nativeTransfers : [];
            for (const nt of nativeTransfers) {
              if (nt.fromUserAccount === wallet) {
                walletActivity[wallet].solSpent += Math.abs(nt.amount || 0) / 1e9;
              }
            }
          }
        }
      } catch (batchErr) {
        console.error("[find-wallets] Batch error:", batchErr);
      }
    }

    console.log(`[find-wallets] Total wallets found: ${Object.keys(walletActivity).length}`);

    // Step 3: Score and rank
    const candidates = Object.entries(walletActivity)
      .map(([address, data]) => ({
        address,
        buys: data.buys,
        uniqueTokens: data.tokens.size,
        solSpent: Math.round(data.solSpent * 100) / 100,
        score: data.buys * 10 + data.tokens.size * 15 + Math.min(data.solSpent * 2, 50),
      }))
      .filter(w => w.buys >= 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    console.log(`[find-wallets] Candidates after scoring: ${candidates.length}`);

    // Step 4: Verify top candidates with balance check
    const verified: any[] = [];
    for (const candidate of candidates) {
      if (verified.length >= 10) break;
      try {
        const balRes = await fetch(`${HELIUS_RPC}/?api-key=${heliusKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getAssetsByOwner",
            params: {
              ownerAddress: candidate.address,
              displayOptions: { showFungible: true, showNativeBalance: true },
            },
          }),
        });

        if (!balRes.ok) continue;
        const balJson = await balRes.json();
        const nativeBal = balJson.result?.nativeBalance;
        const solBalance = nativeBal ? nativeBal.lamports / 1e9 : 0;
        const solPrice = nativeBal?.price_per_sol || 0;
        const portfolioUsd = solBalance * solPrice;

        const items = balJson.result?.items || [];
        let tokenCount = 0;
        let tokenValueUsd = 0;
        for (const item of items) {
          if (item.interface === "FungibleToken" || item.interface === "FungibleAsset") {
            const info = item.token_info || {};
            const amount = (info.balance || 0) / Math.pow(10, info.decimals || 0);
            const price = info.price_info?.price_per_token || 0;
            if (amount > 0 && !BASE_ASSET_MINTS.has(item.id)) {
              tokenCount++;
              tokenValueUsd += amount * price;
            }
          }
        }

        // Accept wallets with reasonable balance AND token holdings
        if (solBalance > 0.5 && tokenCount >= 1) {
          verified.push({
            ...candidate,
            solBalance: Math.round(solBalance * 100) / 100,
            portfolioUsd: Math.round(portfolioUsd + tokenValueUsd),
            tokenHoldings: tokenCount,
            tokenValueUsd: Math.round(tokenValueUsd),
          });
        }
      } catch (_) {
        // skip on error
      }
    }

    console.log(`[find-wallets] Verified: ${verified.length}`);

    // Step 5: Auto-update tracked_wallets
    if (verified.length >= 2) {
      const newWallets = verified.slice(0, 7).map(w => w.address);

      await supabase.from("bot_config").upsert({
        key: "tracked_wallets",
        value: newWallets,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });

      await supabase.from("notifications").insert({
        type: "discovery",
        title: `🔄 Nowe aktywne portfele (${newWallets.length})`,
        message: verified.slice(0, 7).map(w =>
          `${w.address.slice(0, 6)}...${w.address.slice(-4)} — ${w.buys} zakupów, ${w.uniqueTokens} tokenów, ${w.solBalance} SOL ($${w.portfolioUsd})`
        ).join("\n"),
        details: { wallets: verified.slice(0, 7) },
      });
    }

    return jsonResponse({
      success: true,
      discovered: verified.length,
      candidates: verified,
      total_analyzed: Object.keys(walletActivity).length,
      auto_updated: verified.length >= 2,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[find-wallets] Error:", msg);
    return jsonResponse({ success: false, error: msg }, 500);
  }
});

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
