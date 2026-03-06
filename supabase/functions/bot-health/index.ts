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
  const heliusKey = Deno.env.get("HELIUS_API_KEY");
  const solanaKey = Deno.env.get("SOLANA_PRIVATE_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // 1. Check last bot run
    const { data: lastRun } = await supabase
      .from("bot_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    const lastRunAt = lastRun?.started_at ? new Date(lastRun.started_at) : null;
    const botRunHealthy = lastRunAt ? lastRunAt > fiveMinAgo : false;
    const lastRunStatus = lastRun?.status || "unknown";

    // 2. Check bot enabled
    const { data: botConfig } = await supabase
      .from("bot_config")
      .select("value")
      .eq("key", "bot_enabled")
      .single();
    const botEnabled = botConfig?.value === true;

    // 3. Recent errors (last hour)
    const { data: recentRuns } = await supabase
      .from("bot_runs")
      .select("status, error_message, started_at, duration_ms")
      .gte("started_at", oneHourAgo.toISOString())
      .order("started_at", { ascending: false });

    const totalRuns1h = recentRuns?.length || 0;
    const errorRuns1h = recentRuns?.filter((r: any) => r.status === "error").length || 0;
    const avgDuration = totalRuns1h > 0
      ? Math.round((recentRuns || []).reduce((sum: number, r: any) => sum + (r.duration_ms || 0), 0) / totalRuns1h)
      : 0;
    const errorRate = totalRuns1h > 0 ? Math.round((errorRuns1h / totalRuns1h) * 100) : 0;

    // 4. Open positions health
    const { data: positions } = await supabase
      .from("open_positions")
      .select("id, token_symbol, pnl_pct, updated_at, status")
      .eq("status", "open");

    const openCount = positions?.length || 0;
    const stalePositions = (positions || []).filter((p: any) => {
      const updatedAt = new Date(p.updated_at);
      return updatedAt < fiveMinAgo;
    });

    // 5. RPC health check
    let rpcHealthy = false;
    let rpcLatency = 0;
    if (heliusKey) {
      try {
        const rpcStart = Date.now();
        const rpcRes = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
        });
        rpcLatency = Date.now() - rpcStart;
        if (rpcRes.ok) {
          const rpcData = await rpcRes.json();
          rpcHealthy = rpcData?.result === "ok";
        }
      } catch (_) {
        rpcHealthy = false;
      }
    }

    // 6. Jupiter API health
    let jupiterHealthy = false;
    try {
      const jupRes = await fetch("https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000&slippageBps=50");
      jupiterHealthy = jupRes.ok;
    } catch (_) {
      jupiterHealthy = false;
    }

    // 7. Determine overall health
    const checks = {
      bot_running: botRunHealthy,
      bot_enabled: botEnabled,
      rpc_healthy: rpcHealthy,
      jupiter_healthy: jupiterHealthy,
      low_error_rate: errorRate < 30,
      has_helius_key: !!heliusKey,
      has_wallet_key: !!solanaKey,
    };

    const criticalChecks = [checks.bot_running, checks.rpc_healthy, checks.has_helius_key];
    const allChecks = Object.values(checks);
    const passedCount = allChecks.filter(Boolean).length;

    let overallStatus: "healthy" | "degraded" | "critical" | "offline";
    if (!botEnabled) {
      overallStatus = "offline";
    } else if (criticalChecks.every(Boolean) && passedCount >= allChecks.length - 1) {
      overallStatus = "healthy";
    } else if (criticalChecks.filter(Boolean).length >= 2) {
      overallStatus = "degraded";
    } else {
      overallStatus = "critical";
    }

    // 8. Generate alerts
    const alerts: { level: string; message: string; timestamp: string }[] = [];

    if (!botRunHealthy && botEnabled) {
      alerts.push({
        level: "critical",
        message: `Bot nie uruchomił się od ${lastRunAt ? Math.round((now.getTime() - lastRunAt.getTime()) / 60000) : "?"} min`,
        timestamp: now.toISOString(),
      });
    }

    if (errorRate > 30) {
      alerts.push({
        level: "warning",
        message: `Wysoki wskaźnik błędów: ${errorRate}% (${errorRuns1h}/${totalRuns1h}) w ostatniej godzinie`,
        timestamp: now.toISOString(),
      });
    }

    if (!rpcHealthy && heliusKey) {
      alerts.push({
        level: "critical",
        message: "Helius RPC nie odpowiada — bot nie może komunikować się z blockchainem",
        timestamp: now.toISOString(),
      });
    }

    if (!jupiterHealthy) {
      alerts.push({
        level: "warning",
        message: "Jupiter API nieosiągalne — swapy mogą nie działać",
        timestamp: now.toISOString(),
      });
    }

    if (stalePositions.length > 0) {
      alerts.push({
        level: "warning",
        message: `${stalePositions.length} pozycji nie zaktualizowanych od >5 min`,
        timestamp: now.toISOString(),
      });
    }

    if (!solanaKey) {
      alerts.push({
        level: "critical",
        message: "Brak klucza prywatnego portfela — swapy niemożliwe",
        timestamp: now.toISOString(),
      });
    }

    // 9. If critical alerts exist, create notification
    const criticalAlerts = alerts.filter(a => a.level === "critical");
    if (criticalAlerts.length > 0) {
      // Check if we already sent a notification recently (avoid spam)
      const { data: recentNotif } = await supabase
        .from("notifications")
        .select("id")
        .eq("type", "health_alert")
        .gte("created_at", new Date(now.getTime() - 10 * 60 * 1000).toISOString())
        .limit(1);

      if (!recentNotif || recentNotif.length === 0) {
        await supabase.from("notifications").insert({
          type: "health_alert",
          title: `⚠️ Bot Health: ${overallStatus.toUpperCase()}`,
          message: criticalAlerts.map(a => a.message).join("; "),
          details: { checks, alerts, overallStatus },
        });
      }
    }

    return new Response(JSON.stringify({
      status: overallStatus,
      checked_at: now.toISOString(),
      uptime: {
        bot_running: botRunHealthy,
        bot_enabled: botEnabled,
        last_run_at: lastRunAt?.toISOString() || null,
        last_run_status: lastRunStatus,
        last_run_duration_ms: lastRun?.duration_ms || null,
      },
      performance: {
        runs_last_hour: totalRuns1h,
        errors_last_hour: errorRuns1h,
        error_rate_pct: errorRate,
        avg_duration_ms: avgDuration,
      },
      infrastructure: {
        rpc_healthy: rpcHealthy,
        rpc_latency_ms: rpcLatency,
        jupiter_healthy: jupiterHealthy,
        helius_key_set: !!heliusKey,
        wallet_key_set: !!solanaKey,
      },
      positions: {
        open_count: openCount,
        stale_count: stalePositions.length,
      },
      checks,
      alerts,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ status: "error", error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
