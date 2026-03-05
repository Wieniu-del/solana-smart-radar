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
    // Get current tracked wallets as seeds
    const { data: walletsConfig } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "tracked_wallets")
      .single();
    const currentWallets: string[] = (walletsConfig?.value as string[]) || [];

    if (currentWallets.length === 0) {
      return jsonResponse({ success: false, error: "No seed wallets configured" });
    }

    const walletActivity: Record<string, { buys: number; tokens: Set<string>; solSpent: number }> = {};
    const currentWalletsSet = new Set(currentWallets);

    // For each tracked wallet, scan their transactions and find counterparties
    for (const seedWallet of currentWallets) {
      try {
        console.log(`[find-wallets] Scanning seed: ${seedWallet.slice(0, 8)}...`);
        const txRes = await fetch(
          `${HELIUS_BASE}/addresses/${seedWallet}/transactions?api-key=${heliusKey}&limit=100`
        );
        
        if (!txRes.ok) {
          console.error(`[find-wallets] Seed ${seedWallet.slice(0, 8)} failed: ${txRes.status}`);
          continue;
        }

        const txns = await txRes.json();
        console.log(`[find-wallets] Seed ${seedWallet.slice(0, 8)}: ${txns.length} txns`);

        // Also check what tokens this wallet holds to find other holders
        for (const tx of txns) {
          const transfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
          
          // Collect all wallets involved in swaps
          for (const t of transfers) {
            const counterparties = [t.fromUserAccount, t.toUserAccount].filter(
              (a: string) => a && !currentWalletsSet.has(a) && a !== seedWallet
            );

            for (const cp of counterparties) {
              if (!cp) continue;
              // Check if this counterparty received a non-base token
              const receivedToken = transfers.find(
                (tt: any) => tt.toUserAccount === cp && tt.mint && !BASE_ASSET_MINTS.has(tt.mint)
              );
              
              if (receivedToken) {
                if (!walletActivity[cp]) {
                  walletActivity[cp] = { buys: 0, tokens: new Set(), solSpent: 0 };
                }
                walletActivity[cp].buys++;
                walletActivity[cp].tokens.add(receivedToken.mint);
              }
            }
          }

          // Also look at the feePayer as potential trader
          if (tx.feePayer && !currentWalletsSet.has(tx.feePayer) && tx.feePayer !== seedWallet) {
            const fp = tx.feePayer;
            const fpReceived = transfers.find(
              (t: any) => t.toUserAccount === fp && t.mint && !BASE_ASSET_MINTS.has(t.mint)
            );
            if (fpReceived) {
              if (!walletActivity[fp]) {
                walletActivity[fp] = { buys: 0, tokens: new Set(), solSpent: 0 };
              }
              walletActivity[fp].buys++;
              walletActivity[fp].tokens.add(fpReceived.mint);
            }
          }
        }

        // Also scan what tokens this seed wallet holds
        // and look for other significant holders
        const balRes = await fetch(`${HELIUS_RPC}/?api-key=${heliusKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getAssetsByOwner",
            params: {
              ownerAddress: seedWallet,
              displayOptions: { showFungible: true, showNativeBalance: true },
            },
          }),
        });

        if (balRes.ok) {
          const balJson = await balRes.json();
          const items = balJson.result?.items || [];
          
          for (const item of items) {
            if (item.interface === "FungibleToken" || item.interface === "FungibleAsset") {
              const info = item.token_info || {};
              const amount = (info.balance || 0) / Math.pow(10, info.decimals || 0);
              const price = info.price_info?.price_per_token || 0;
              const valueUsd = amount * price;
              
              // If seed wallet holds a valuable non-base token, this is a candidate for the bot
              if (!BASE_ASSET_MINTS.has(item.id) && valueUsd > 100) {
                // Mark the seed wallet itself as having interesting tokens
                if (!walletActivity[seedWallet]) {
                  walletActivity[seedWallet] = { buys: 0, tokens: new Set(), solSpent: 0 };
                }
                walletActivity[seedWallet].tokens.add(item.id);
                walletActivity[seedWallet].buys++;
              }
            }
          }
        }
      } catch (err) {
        console.error(`[find-wallets] Seed error:`, err);
      }
    }

    console.log(`[find-wallets] Total unique wallets found: ${Object.keys(walletActivity).length}`);

    // Score and rank (exclude current tracked wallets from NEW candidates)
    const newCandidates = Object.entries(walletActivity)
      .filter(([addr]) => !currentWalletsSet.has(addr))
      .map(([address, data]) => ({
        address,
        buys: data.buys,
        uniqueTokens: data.tokens.size,
        solSpent: Math.round(data.solSpent * 100) / 100,
        score: data.buys * 10 + data.tokens.size * 15 + Math.min(data.solSpent * 2, 50),
      }))
      .filter(w => w.buys >= 2 || w.uniqueTokens >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    // Also check which current wallets are still active (have token holdings)
    const activeCurrentWallets = Object.entries(walletActivity)
      .filter(([addr]) => currentWalletsSet.has(addr))
      .map(([address, data]) => ({
        address,
        buys: data.buys,
        uniqueTokens: data.tokens.size,
        active: true,
      }));

    console.log(`[find-wallets] New candidates: ${newCandidates.length}, active current: ${activeCurrentWallets.length}`);

    // Verify new candidates with balance check
    const verified: any[] = [];
    for (const candidate of newCandidates) {
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

        if (solBalance > 0.3 && tokenCount >= 1) {
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

    console.log(`[find-wallets] Verified new: ${verified.length}`);

    // Build updated wallet list: keep active current + add new verified
    const keepWallets = activeCurrentWallets.map(w => w.address);
    const addWallets = verified.map(w => w.address);
    const mergedWallets = [...new Set([...keepWallets, ...addWallets])].slice(0, 10);

    if (mergedWallets.length >= 2 && addWallets.length > 0) {
      await supabase.from("bot_config").upsert({
        key: "tracked_wallets",
        value: mergedWallets,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });

      await supabase.from("notifications").insert({
        type: "discovery",
        title: `🔄 Tracked wallets zaktualizowane (${mergedWallets.length})`,
        message: `Zachowano ${keepWallets.length} aktywnych + dodano ${addWallets.length} nowych.\n` +
          verified.slice(0, 5).map(w =>
            `${w.address.slice(0, 6)}...${w.address.slice(-4)} — ${w.buys} buy, ${w.tokenHoldings} tokenów, $${w.portfolioUsd}`
          ).join("\n"),
        details: { 
          kept: keepWallets.length,
          added: addWallets.length,
          total: mergedWallets.length,
          new_wallets: verified.slice(0, 5),
        },
      });
    }

    return jsonResponse({
      success: true,
      discovered: verified.length,
      active_current: activeCurrentWallets.length,
      total_current: currentWallets.length,
      candidates: verified,
      total_analyzed: Object.keys(walletActivity).length,
      auto_updated: mergedWallets.length >= 2 && addWallets.length > 0,
      new_tracked_wallets: mergedWallets,
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
