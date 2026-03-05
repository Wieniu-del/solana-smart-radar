import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const heliusKey = Deno.env.get("HELIUS_API_KEY");
    if (!heliusKey) {
      return jsonResponse({ success: false, error: "HELIUS_API_KEY not configured" }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get current tracked wallets to avoid duplicates
    const { data: walletsConfig } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "tracked_wallets")
      .single();
    const currentWallets: string[] = (walletsConfig?.value as string[]) || [];

    // Strategy: Use Helius DAS API to search for recent token activity
    // Find wallets with high recent swap activity by searching known active tokens
    const knownActiveTokens = [
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
      "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
      "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",  // JUP
    ];

    const walletActivity: Record<string, { swaps: number; totalValue: number; tokens: Set<string> }> = {};

    // Use Helius parsed transaction history for known active wallets from recent signals
    // Approach: search recent trading_signals for active wallet addresses, then discover new ones nearby
    const { data: recentSignals } = await supabase
      .from("trading_signals")
      .select("wallet_address")
      .order("created_at", { ascending: false })
      .limit(20);

    const seedWallets = [...new Set((recentSignals || []).map(s => s.wallet_address))].slice(0, 5);

    // For each seed wallet, look at their recent transaction counterparties
    for (const seedWallet of seedWallets) {
      try {
        const txRes = await fetch(
          `https://api.helius.xyz/v0/addresses/${seedWallet}/transactions?api-key=${heliusKey}&limit=50&type=SWAP`
        );

        if (!txRes.ok) continue;

        const txns = await txRes.json();

        for (const tx of txns) {
          // Look at other accounts involved in these swaps
          const feePayer = tx.feePayer;
          if (!feePayer || feePayer === seedWallet || currentWallets.includes(feePayer)) continue;

          if (!walletActivity[feePayer]) {
            walletActivity[feePayer] = { swaps: 0, totalValue: 0, tokens: new Set() };
          }
          walletActivity[feePayer].swaps++;

          const transfers = tx.tokenTransfers || [];
          for (const t of transfers) {
            if (t.mint) walletActivity[feePayer].tokens.add(t.mint);
            // Also check other user accounts as potential smart wallets
            for (const account of [t.fromUserAccount, t.toUserAccount]) {
              if (account && account !== seedWallet && account !== feePayer && !currentWallets.includes(account)) {
                if (!walletActivity[account]) {
                  walletActivity[account] = { swaps: 0, totalValue: 0, tokens: new Set() };
                }
                walletActivity[account].tokens.add(t.mint);
              }
            }
          }

          const nativeTransfers = tx.nativeTransfers || [];
          for (const nt of nativeTransfers) {
            if (nt.fromUserAccount === feePayer) {
              walletActivity[feePayer].totalValue += Math.abs(nt.amount || 0) / 1e9;
            }
          }
        }
      } catch (_) {
        // Skip on error
      }
    }

    // If no seed wallets, use a fallback: search for recent large token holders
    if (seedWallets.length === 0) {
      // Use getSignaturesForAddress on a popular token mint as fallback
      try {
        const rpcRes = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getSignaturesForAddress",
            params: [knownActiveTokens[3], { limit: 50 }], // JUP token
          }),
        });

        if (rpcRes.ok) {
          const rpcJson = await rpcRes.json();
          const sigs = (rpcJson.result || []).map((s: any) => s.signature).slice(0, 20);

          // Parse these transactions
          if (sigs.length > 0) {
            const parseRes = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${heliusKey}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transactions: sigs }),
            });

            if (parseRes.ok) {
              const parsedTxns = await parseRes.json();
              for (const tx of parsedTxns) {
                const feePayer = tx.feePayer;
                if (!feePayer || currentWallets.includes(feePayer)) continue;
                if (!walletActivity[feePayer]) {
                  walletActivity[feePayer] = { swaps: 0, totalValue: 0, tokens: new Set() };
                }
                walletActivity[feePayer].swaps++;
                for (const t of (tx.tokenTransfers || [])) {
                  if (t.mint) walletActivity[feePayer].tokens.add(t.mint);
                }
              }
            }
          }
        }
      } catch (_) {
        // Fallback failed, continue with whatever we have
      }
    }

    // Score and rank wallets
    const candidates = Object.entries(walletActivity)
      .map(([address, data]) => ({
        address,
        swaps: data.swaps,
        totalValue: data.totalValue,
        tokenDiversity: data.tokens.size,
        score: data.swaps * 10 + data.tokenDiversity * 5 + Math.min(data.totalValue, 100),
      }))
      .filter((w) => w.swaps >= 2 && w.tokenDiversity >= 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    // Verify candidates with balance check
    const verifiedCandidates = [];
    for (const candidate of candidates) {
      try {
        const balRes = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
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

        if (balRes.ok) {
          const balJson = await balRes.json();
          const nativeBal = balJson.result?.nativeBalance;
          const solBalance = nativeBal ? nativeBal.lamports / 1e9 : 0;
          const solPrice = nativeBal?.price_per_sol || 0;
          const portfolioUsd = solBalance * solPrice;

          if (portfolioUsd > 500 || solBalance > 2) {
            verifiedCandidates.push({
              ...candidate,
              solBalance: Math.round(solBalance * 100) / 100,
              portfolioUsd: Math.round(portfolioUsd),
            });
          }
        }
      } catch (_) {
        // Skip on error
      }

      if (verifiedCandidates.length >= 5) break;
    }

    // Save discovered wallets to notifications
    if (verifiedCandidates.length > 0) {
      await supabase.from("notifications").insert({
        type: "discovery",
        title: `🔍 Odkryto ${verifiedCandidates.length} nowych portfeli smart money`,
        message: verifiedCandidates.map((w) =>
          `${w.address.slice(0, 6)}...${w.address.slice(-4)} — ${w.swaps} swapów, ${w.tokenDiversity} tokenów, ${w.solBalance} SOL`
        ).join("\n"),
        details: { candidates: verifiedCandidates },
      });
    }

    return jsonResponse({
      success: true,
      discovered: verifiedCandidates.length,
      candidates: verifiedCandidates,
      total_analyzed: Object.keys(walletActivity).length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Discovery error:", msg);
    return jsonResponse({ success: false, error: msg }, 500);
  }
});

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
