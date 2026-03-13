import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Simple API key auth via header or query param
  const url = new URL(req.url);
  const apiKeyHeader = req.headers.get("x-api-key");
  const apiKeyParam = url.searchParams.get("api_key");
  const providedKey = apiKeyHeader || apiKeyParam;

  // Validate API key from bot_config
  const { data: apiKeyConfig } = await supabase
    .from("bot_config")
    .select("value")
    .eq("key", "bot_api_key")
    .maybeSingle();

  const storedKey = apiKeyConfig?.value as string;
  if (!storedKey) {
    return json({ error: "API key not configured. Set 'bot_api_key' in bot_config." }, 500);
  }
  if (providedKey !== storedKey) {
    return json({ error: "Unauthorized — invalid or missing API key" }, 401);
  }

  // Route based on path
  const path = url.pathname.split("/").filter(Boolean);
  const endpoint = path[path.length - 1] || "status";
  const method = req.method;

  try {
    switch (endpoint) {
      case "status":
        return await handleStatus(supabase);
      case "signals":
        return await handleSignals(supabase, url);
      case "positions":
        return await handlePositions(supabase, url);
      case "config":
        if (method === "GET") return await handleConfigGet(supabase);
        if (method === "POST" || method === "PUT") return await handleConfigSet(supabase, req);
        break;
      case "scan":
        if (method === "POST") return await handleScan(supabaseUrl, supabaseKey);
        break;
      case "diagnostics":
        return await handleDiagnostics(supabase, url);
      case "pnl":
        return await handlePnL(supabase, url);
      default:
        return json({
          error: "Unknown endpoint",
          endpoints: {
            "GET /status": "Bot status, balance, open positions count",
            "GET /signals?limit=20&status=pending": "Recent trading signals",
            "GET /positions?status=open": "Open/closed positions",
            "GET /config": "Bot configuration",
            "POST /config": "Update bot config { key, value }",
            "POST /scan": "Trigger manual bot scan",
            "GET /diagnostics?range=24h": "Signal diagnostics (generated/executed/rejected)",
            "GET /pnl?range=7d": "PnL summary",
          }
        }, 404);
    }
  } catch (err) {
    console.error("Bot API error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }

  return json({ error: "Method not allowed" }, 405);
});

// ─── Handlers ───

async function handleStatus(supabase: any) {
  const [
    { data: enabledConfig },
    { count: openCount },
    { data: lastRun },
    { data: sellOnlyConfig },
  ] = await Promise.all([
    supabase.from("bot_config").select("value").eq("key", "bot_enabled").maybeSingle(),
    supabase.from("open_positions").select("*", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("bot_runs").select("*").order("started_at", { ascending: false }).limit(1),
    supabase.from("bot_config").select("value").eq("key", "sell_only_mode").maybeSingle(),
  ]);

  // Get SOL balance
  let balanceSol = null;
  try {
    const solPubKey = Deno.env.get("SOLANA_PUBLIC_KEY");
    const heliusKey = Deno.env.get("HELIUS_API_KEY");
    if (solPubKey && heliusKey) {
      const balRes = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [solPubKey] }),
      });
      const balData = await balRes.json();
      balanceSol = (balData?.result?.value || 0) / 1e9;
    }
  } catch (_) {}

  const run = lastRun?.[0];
  return json({
    bot_enabled: enabledConfig?.value === true,
    sell_only_mode: sellOnlyConfig?.value === true,
    open_positions: openCount || 0,
    balance_sol: balanceSol,
    last_run: run ? {
      status: run.status,
      started_at: run.started_at,
      duration_ms: run.duration_ms,
      wallets_scanned: run.wallets_scanned,
      tokens_found: run.tokens_found,
      signals_generated: run.signals_generated,
      buy_signals: run.buy_signals,
    } : null,
  });
}

async function handleSignals(supabase: any, url: URL) {
  const limit = Math.min(100, Number(url.searchParams.get("limit")) || 20);
  const status = url.searchParams.get("status");

  let query = supabase
    .from("trading_signals")
    .select("id, token_symbol, token_mint, signal_type, confidence, status, strategy, created_at, conditions")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;

  return json({ count: data?.length || 0, signals: data || [] });
}

async function handlePositions(supabase: any, url: URL) {
  const status = url.searchParams.get("status") || "open";
  const limit = Math.min(100, Number(url.searchParams.get("limit")) || 20);

  const { data, error } = await supabase
    .from("open_positions")
    .select("*")
    .eq("status", status)
    .order(status === "open" ? "opened_at" : "closed_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return json({
    count: data?.length || 0,
    positions: (data || []).map((p: any) => ({
      id: p.id,
      token_symbol: p.token_symbol,
      token_mint: p.token_mint,
      entry_price_usd: p.entry_price_usd,
      current_price_usd: p.current_price_usd,
      pnl_pct: p.pnl_pct,
      amount_sol: p.amount_sol,
      status: p.status,
      close_reason: p.close_reason,
      opened_at: p.opened_at,
      closed_at: p.closed_at,
    })),
  });
}

async function handleConfigGet(supabase: any) {
  const { data, error } = await supabase.from("bot_config").select("key, value, updated_at");
  if (error) throw error;

  const config: Record<string, any> = {};
  for (const c of data || []) {
    if (c.key === "bot_api_key") continue; // Don't expose API key
    config[c.key] = c.value;
  }

  return json({ config });
}

async function handleConfigSet(supabase: any, req: Request) {
  const body = await req.json();
  const { key, value } = body;

  if (!key || value === undefined) {
    return json({ error: "Missing 'key' or 'value' in request body" }, 400);
  }

  // Block sensitive keys
  if (key === "bot_api_key") {
    return json({ error: "Cannot update API key via API" }, 403);
  }

  const { error } = await supabase
    .from("bot_config")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });

  if (error) throw error;

  return json({ success: true, key, value });
}

async function handleScan(supabaseUrl: string, supabaseKey: string) {
  const res = await fetch(`${supabaseUrl}/functions/v1/bot-monitor`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ manual: true }),
  });

  const data = await res.json();
  return json({ success: res.ok, scan_result: data });
}

async function handleDiagnostics(supabase: any, url: URL) {
  const range = url.searchParams.get("range") || "24h";
  const rangeMs: Record<string, number> = { "1h": 3600000, "24h": 86400000, "7d": 604800000, "30d": 2592000000 };
  const since = new Date(Date.now() - (rangeMs[range] || 86400000)).toISOString();

  const { data } = await supabase
    .from("trading_signals")
    .select("status, confidence")
    .gte("created_at", since);

  const stats = { total: 0, pending: 0, executed: 0, rejected: 0, expired: 0, approved: 0, avg_confidence: 0 };
  let totalConf = 0;

  for (const s of data || []) {
    stats.total++;
    totalConf += s.confidence || 0;
    if (s.status === "pending") stats.pending++;
    else if (s.status === "executed") stats.executed++;
    else if (s.status === "rejected") stats.rejected++;
    else if (s.status === "expired") stats.expired++;
    else if (s.status === "approved") stats.approved++;
  }

  stats.avg_confidence = stats.total > 0 ? Math.round(totalConf / stats.total) : 0;

  return json({
    range,
    ...stats,
    execution_rate: stats.total > 0 ? `${((stats.executed / stats.total) * 100).toFixed(1)}%` : "0%",
    rejection_rate: stats.total > 0 ? `${((stats.rejected / stats.total) * 100).toFixed(1)}%` : "0%",
  });
}

async function handlePnL(supabase: any, url: URL) {
  const range = url.searchParams.get("range") || "7d";
  const rangeMs: Record<string, number> = { "24h": 86400000, "7d": 604800000, "30d": 2592000000 };
  const since = new Date(Date.now() - (rangeMs[range] || 604800000)).toISOString();

  const { data } = await supabase
    .from("open_positions")
    .select("pnl_pct, amount_sol, close_reason, closed_at")
    .eq("status", "closed")
    .gte("closed_at", since);

  const positions = data || [];
  const totalTrades = positions.length;
  const wins = positions.filter((p: any) => (p.pnl_pct || 0) > 0).length;
  const losses = positions.filter((p: any) => (p.pnl_pct || 0) <= 0).length;
  const totalPnlPct = positions.reduce((s: number, p: any) => s + (p.pnl_pct || 0), 0);
  const avgPnl = totalTrades > 0 ? (totalPnlPct / totalTrades).toFixed(2) : "0";

  const byReason: Record<string, number> = {};
  for (const p of positions) {
    const r = p.close_reason || "unknown";
    byReason[r] = (byReason[r] || 0) + 1;
  }

  return json({
    range,
    total_trades: totalTrades,
    wins, losses,
    win_rate: totalTrades > 0 ? `${((wins / totalTrades) * 100).toFixed(1)}%` : "0%",
    avg_pnl_pct: avgPnl,
    total_pnl_pct: totalPnlPct.toFixed(2),
    close_reasons: byReason,
  });
}

// ─── Helpers ───
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
