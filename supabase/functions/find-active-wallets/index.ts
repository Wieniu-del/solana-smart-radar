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

// Known trending tokens to scan recent buyers of
const TRENDING_TOKENS = [
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",  // JUP
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", // WIF
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", // POPCAT
  "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump", // GOAT
  "HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC", // AI16Z
];

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
    // Strategy: Find wallets that recently bought trending tokens
    // by scanning recent transaction signatures on these tokens
    const walletActivity: Record<string, { buys: number; tokens: Set<string>; totalSolSpent: number }> = {};

    for (const tokenMint of TRENDING_TOKENS) {
      try {
        // Get recent signatures for this token
        const sigRes = await fetch(`${HELIUS_RPC}/?api-key=${heliusKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getSignaturesForAddress",
            params: [tokenMint, { limit: 30 }],
          }),
        });

        if (!sigRes.ok) continue;
        const sigJson = await sigRes.json();
        const sigs = (sigJson.result || []).map((s: any) => s.signature).slice(0, 15);
        if (sigs.length === 0) continue;

        // Parse these transactions
        const parseRes = await fetch(`${HELIUS_BASE}/transactions?api-key=${heliusKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: sigs }),
        });

        if (!parseRes.ok) continue;
        const parsedTxns = await parseRes.json();

        for (const tx of parsedTxns) {
          if (!tx?.feePayer) continue;
          const wallet = tx.feePayer;
          const transfers = tx.tokenTransfers || [];

          // Look for buys: wallet receives non-base token
          for (const t of transfers) {
            if (t.toUserAccount === wallet && t.mint && !BASE_ASSET_MINTS.has(t.mint)) {
              if (!walletActivity[wallet]) {
                walletActivity[wallet] = { buys: 0, tokens: new Set(), totalSolSpent: 0 };
              }
              walletActivity[wallet].buys++;
              walletActivity[wallet].tokens.add(t.mint);
            }
          }

          // Track SOL spent
          const nativeTransfers = tx.nativeTransfers || [];
          for (const nt of nativeTransfers) {
            if (nt.fromUserAccount === wallet && walletActivity[wallet]) {
              walletActivity[wallet].totalSolSpent += Math.abs(nt.amount || 0) / 1e9;
            }
          }
        }
      } catch (_) {
        // skip token on error
      }
    }

    // Score and filter wallets
    const candidates = Object.entries(walletActivity)
      .map(([address, data]) => ({
        address,
        buys: data.buys,
        uniqueTokens: data.tokens.size,
        solSpent: Math.round(data.totalSolSpent * 100) / 100,
        score: data.buys * 10 + data.tokens.size * 15 + Math.min(data.totalSolSpent * 2, 50),
      }))
      .filter(w => w.buys >= 2 && w.uniqueTokens >= 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    // Verify with balance check
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

        // Count non-base token holdings
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

        if ((portfolioUsd > 1000 || solBalance > 3) && tokenCount >= 1) {
          verified.push({
            ...candidate,
            solBalance: Math.round(solBalance * 100) / 100,
            portfolioUsd: Math.round(portfolioUsd),
            tokenHoldings: tokenCount,
            tokenValueUsd: Math.round(tokenValueUsd),
          });
        }
      } catch (_) {
        // skip
      }
    }

    // Auto-update tracked_wallets if we found good candidates
    if (verified.length >= 3) {
      const newWallets = verified.slice(0, 7).map(w => w.address);
      
      await supabase.from("bot_config").upsert({
        key: "tracked_wallets",
        value: newWallets,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });

      await supabase.from("notifications").insert({
        type: "discovery",
        title: `🔄 Zaktualizowano tracked_wallets (${newWallets.length} portfeli)`,
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
      auto_updated: verified.length >= 3,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("find-active-wallets error:", msg);
    return jsonResponse({ success: false, error: msg }, 500);
  }
});

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
