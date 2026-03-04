import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const HELIUS_BASE = "https://api.helius.xyz/v0";

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

    // Strategy: Find wallets with high swap activity on popular tokens
    // We'll look at recent large transactions on known DEX programs
    const knownProfitablePatterns = [
      // Search for wallets that recently did profitable swaps
      // Using Helius enhanced transactions API
    ];

    // 1. Get recent large swaps from Jupiter aggregator
    const jupiterProgram = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
    
    // Fetch recent transactions from Jupiter
    const txRes = await fetch(
      `${HELIUS_BASE}/addresses/${jupiterProgram}/transactions?api-key=${heliusKey}&limit=100&type=SWAP`
    );

    if (!txRes.ok) {
      return jsonResponse({ success: false, error: "Failed to fetch Jupiter transactions" }, 500);
    }

    const txns = await txRes.json();

    // 2. Extract unique wallets and count their activity
    const walletActivity: Record<string, { swaps: number; totalValue: number; tokens: Set<string> }> = {};

    for (const tx of txns) {
      const feePayer = tx.feePayer;
      if (!feePayer || currentWallets.includes(feePayer)) continue;

      if (!walletActivity[feePayer]) {
        walletActivity[feePayer] = { swaps: 0, totalValue: 0, tokens: new Set() };
      }
      walletActivity[feePayer].swaps++;

      // Track token diversity
      const transfers = tx.tokenTransfers || [];
      for (const t of transfers) {
        if (t.mint) walletActivity[feePayer].tokens.add(t.mint);
      }

      // Estimate value from native transfers
      const nativeTransfers = tx.nativeTransfers || [];
      for (const nt of nativeTransfers) {
        walletActivity[feePayer].totalValue += Math.abs(nt.amount || 0) / 1e9;
      }
    }

    // 3. Score and rank wallets
    const candidates = Object.entries(walletActivity)
      .map(([address, data]) => ({
        address,
        swaps: data.swaps,
        totalValue: data.totalValue,
        tokenDiversity: data.tokens.size,
        score: data.swaps * 10 + data.tokenDiversity * 5 + Math.min(data.totalValue, 100),
      }))
      .filter((w) => w.swaps >= 3 && w.tokenDiversity >= 2) // Min 3 swaps, 2 different tokens
      .sort((a, b) => b.score - a.score)
      .slice(0, 10); // Top 10

    // 4. Verify candidates with balance check (filter out bots/low value)
    const verifiedCandidates = [];
    for (const candidate of candidates.slice(0, 15)) {
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

          // Only keep wallets with meaningful balance (>$500)
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

      if (verifiedCandidates.length >= 5) break; // Max 5 new discoveries
    }

    // 5. Save discovered wallets to notifications
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
