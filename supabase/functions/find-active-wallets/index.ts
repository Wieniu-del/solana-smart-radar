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

// Known active wallets to use as seeds for discovering counterparties
const SEED_WALLETS = [
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", // Raydium Authority
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", // Known active trader
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
    const walletActivity: Record<string, { buys: number; tokens: Set<string>; solSpent: number }> = {};

    // Strategy: Get recent transactions from known active swap wallets
    // and find their counterparties who are buying tokens
    for (const seedWallet of SEED_WALLETS) {
      try {
        console.log(`[find-wallets] Scanning seed: ${seedWallet.slice(0, 8)}...`);
        const txRes = await fetch(
          `${HELIUS_BASE}/addresses/${seedWallet}/transactions?api-key=${heliusKey}&limit=100`
        );
        
        if (!txRes.ok) {
          console.error(`[find-wallets] Seed ${seedWallet.slice(0,8)} failed: ${txRes.status}`);
          continue;
        }

        const txns = await txRes.json();
        console.log(`[find-wallets] Seed ${seedWallet.slice(0,8)}: ${txns.length} txns`);

        for (const tx of txns) {
          if (!tx?.feePayer || tx.feePayer === seedWallet) continue;
          
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

          if (walletActivity[wallet]) {
            const nativeTransfers = Array.isArray(tx.nativeTransfers) ? tx.nativeTransfers : [];
            for (const nt of nativeTransfers) {
              if (nt.fromUserAccount === wallet) {
                walletActivity[wallet].solSpent += Math.abs(nt.amount || 0) / 1e9;
              }
            }
          }
        }
      } catch (err) {
        console.error(`[find-wallets] Seed error:`, err);
      }
    }

    console.log(`[find-wallets] Total unique wallets: ${Object.keys(walletActivity).length}`);

    // Score and rank
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
      .slice(0, 15);

    console.log(`[find-wallets] Scored candidates: ${candidates.length}`);

    // Verify top candidates
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
        if (balJson.error) continue;

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

        if (solBalance > 0.5 && tokenCount >= 1) {
          verified.push({
            ...candidate,
            solBalance: Math.round(solBalance * 100) / 100,
            portfolioUsd: Math.round(portfolioUsd + tokenValueUsd),
            tokenHoldings: tokenCount,
            tokenValueUsd: Math.round(tokenValueUsd),
          });
        }
      } catch (_) {}
    }

    console.log(`[find-wallets] Verified: ${verified.length}`);

    // Auto-update tracked_wallets
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
          `${w.address.slice(0, 6)}...${w.address.slice(-4)} — ${w.buys} buy, ${w.uniqueTokens} tokenów, ${w.solBalance} SOL ($${w.portfolioUsd})`
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
