import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Clock, TrendingUp,
  TrendingDown, Zap, RefreshCw, Shield, DollarSign, Timer, BarChart3,
  Target, Loader2, Wifi, WifiOff
} from "lucide-react";

interface CriticalIssue {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  timestamp?: string;
}

interface DiagData {
  // Bot status
  botRunning: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunDuration: number | null;
  runsLast1h: number;
  errorsLast1h: number;

  // Positions
  openPositions: number;
  closedToday: number;
  closedReasons: Record<string, number>;

  // Signals
  pendingSignals: number;
  executedToday: number;
  rejectedToday: number;
  expiredToday: number;
  totalSignalsToday: number;

  // PnL
  winRate: number;
  totalPnlToday: number;
  avgPnl: number;

  // Config
  sellOnlyMode: boolean;
  maxPositions: number;
  trailingStartPct: number;
  stopLossPct: number;
  minBalanceSol: number;

  // Strategies  
  enabledStrategies: string[];
  taStrategies: string[];

  // Errors
  recentErrors: Array<{ time: string; message: string; type: string }>;

  // Critical issues (auto-detected)
  criticalIssues: CriticalIssue[];

  // SELL failures
  sellFailures24h: number;
  sellSuccesses24h: number;

  // Dead tokens
  deadTokensToday: number;
}

export default function BotDiagnosticsPanel() {
  const [data, setData] = useState<DiagData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDiagnostics = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

      const [
        runsRes, openPosRes, closedTodayRes, signalsRes,
        configRes, notifRes, strategiesRes, sellExecRes
      ] = await Promise.all([
        supabase.from("bot_runs").select("*").gte("started_at", oneHourAgo).order("started_at", { ascending: false }).limit(20),
        supabase.from("open_positions").select("*").eq("status", "open"),
        supabase.from("open_positions").select("*").eq("status", "closed").gte("closed_at", todayStart),
        supabase.from("trading_signals").select("*").gte("created_at", todayStart),
        supabase.from("bot_config").select("*"),
        supabase.from("notifications").select("*").in("type", ["swap_error", "balance_guard"]).gte("created_at", oneHourAgo).order("created_at", { ascending: false }).limit(10),
        supabase.from("trading_strategies").select("*"),
        supabase.from("trade_executions").select("*").eq("action", "SELL").gte("created_at", todayStart),
      ]);

      const runs = runsRes.data || [];
      const closedToday = closedTodayRes.data || [];
      const signals = signalsRes.data || [];
      const configs = configRes.data || [];
      const notifications = notifRes.data || [];
      const sellExecs = sellExecRes.data || [];

      const getConfig = (key: string, def: any = null) => {
        const c = configs.find((c: any) => c.key === key);
        return c?.value ?? def;
      };

      // Close reasons breakdown
      const closedReasons: Record<string, number> = {};
      for (const p of closedToday) {
        const reason = p.close_reason || "unknown";
        closedReasons[reason] = (closedReasons[reason] || 0) + 1;
      }

      // PnL stats
      const pnls = closedToday.map((p: any) => Number(p.pnl_pct) || 0);
      const wins = pnls.filter((p: number) => p > 0).length;
      const winRate = pnls.length > 0 ? (wins / pnls.length) * 100 : 0;
      const totalPnl = pnls.reduce((s: number, p: number) => s + p, 0);
      const avgPnl = pnls.length > 0 ? totalPnl / pnls.length : 0;

      // TA strategies from config
      const taConfig = getConfig("ta_strategies", {});
      const taEnabled = Object.entries(taConfig || {})
        .filter(([_, v]: any) => v === true)
        .map(([k]: any) => k);

      const lastRun = runs[0] || null;

      // SELL stats
      const sellFailures24h = sellExecs.filter((e: any) => e.status === "failed").length;
      const sellSuccesses24h = sellExecs.filter((e: any) => e.status === "executed").length;
      const deadTokensToday = closedReasons["dead_token"] || 0;

      // Signal stats
      const executedToday = signals.filter((s: any) => s.status === "executed").length;
      const rejectedToday = signals.filter((s: any) => s.status === "rejected").length;
      const expiredToday = signals.filter((s: any) => s.status === "expired").length;
      const totalSignalsToday = signals.length;

      // ── AUTO-DETECT CRITICAL ISSUES ──
      const criticalIssues: CriticalIssue[] = [];

      // 1. Bot nie handluje — 0 executed w 24h + sygnały rejected/expired
      if (executedToday === 0 && (rejectedToday + expiredToday) > 5) {
        criticalIssues.push({
          severity: "critical",
          title: "Bot nie handluje",
          detail: `0 wykonanych transakcji przy ${rejectedToday} odrzuconych i ${expiredToday} wygasłych sygnałach. Prawdopodobny problem z filtrami wejścia lub danymi rynkowymi.`,
        });
      }

      // 2. Liquidity deadlock — >80% sygnałów odrzuconych
      const rejectionRate = totalSignalsToday > 0 ? (rejectedToday / totalSignalsToday) * 100 : 0;
      if (rejectionRate > 80 && totalSignalsToday > 10) {
        criticalIssues.push({
          severity: "critical",
          title: "Liquidity Deadlock",
          detail: `${rejectionRate.toFixed(0)}% sygnałów odrzuconych (${rejectedToday}/${totalSignalsToday}). DexScreener może zwracać $0 liquidity (rate limiting) lub filtry są zbyt restrykcyjne.`,
        });
      }

      // 3. SELL failures — więcej niż 3 failowe SELL w 24h
      if (sellFailures24h >= 3) {
        const sellFailRate = sellFailures24h + sellSuccesses24h > 0 
          ? ((sellFailures24h / (sellFailures24h + sellSuccesses24h)) * 100).toFixed(0) 
          : "100";
        criticalIssues.push({
          severity: sellFailures24h >= 5 ? "critical" : "warning",
          title: `SELL Failures: ${sellFailures24h}x`,
          detail: `${sellFailRate}% SELL-i kończy się błędem. Sprawdź slippage, balance tokena lub Jupiter routing.`,
        });
      }

      // 4. Dead tokens — katastrofalne straty
      if (deadTokensToday >= 2) {
        criticalIssues.push({
          severity: "warning",
          title: `Dead Tokens: ${deadTokensToday}x`,
          detail: `${deadTokensToday} tokenów okazało się martwych (-100% PnL). Filtry bezpieczeństwa mogą być zbyt słabe.`,
        });
      }

      // 5. Bot errors — więcej niż 3 błędy w ostatniej godzinie
      const errorsLast1h = runs.filter((r: any) => r.status === "error").length;
      if (errorsLast1h >= 3) {
        criticalIssues.push({
          severity: "critical",
          title: `Błędy bota: ${errorsLast1h}x/h`,
          detail: `${errorsLast1h} błędów w ostatniej godzinie. Bot może nie działać poprawnie. Sprawdź logi Edge Functions.`,
        });
      }

      // 6. Bot nie odpowiada — brak runów w ostatniej godzinie
      if (runs.length === 0) {
        criticalIssues.push({
          severity: "critical",
          title: "Bot nie odpowiada",
          detail: "Brak cykli bota w ostatniej godzinie. pg_cron może być wyłączony lub Edge Function nie deployuje się poprawnie.",
        });
      }

      // 7. Wysoki wskaźnik strat
      if (pnls.length >= 5 && winRate < 30) {
        criticalIssues.push({
          severity: "warning",
          title: `Niski Win Rate: ${winRate.toFixed(0)}%`,
          detail: `Tylko ${wins}/${pnls.length} zyskownych tradów dziś. Rozważ zaostrzenie kryteriów wejścia.`,
        });
      }

      // 8. Sell-only mode aktywny (info)
      if (getConfig("sell_only_mode", false) === true) {
        criticalIssues.push({
          severity: "info",
          title: "Tryb SELL ONLY",
          detail: "Bot nie otwiera nowych pozycji. Tylko zamyka istniejące.",
        });
      }

      // 9. Recent swap errors from notifications
      const swapErrors = notifications.filter((n: any) => n.type === "swap_error");
      if (swapErrors.length >= 3) {
        criticalIssues.push({
          severity: "warning",
          title: `Swap Errors: ${swapErrors.length}x/h`,
          detail: swapErrors[0]?.message?.slice(0, 150) || "Wielokrotne błędy swap w ostatniej godzinie.",
          timestamp: swapErrors[0]?.created_at ? new Date(swapErrors[0].created_at).toLocaleTimeString("pl-PL") : undefined,
        });
      }

      setData({
        botRunning: runs.some((r: any) => r.status === "running"),
        lastRunAt: lastRun?.started_at || null,
        lastRunStatus: lastRun?.status || null,
        lastRunDuration: lastRun?.duration_ms || null,
        runsLast1h: runs.length,
        errorsLast1h,
        openPositions: (openPosRes.data || []).length,
        closedToday: closedToday.length,
        closedReasons,
        pendingSignals: signals.filter((s: any) => s.status === "pending").length,
        executedToday,
        rejectedToday,
        expiredToday,
        totalSignalsToday,
        winRate,
        totalPnlToday: totalPnl,
        avgPnl,
        sellOnlyMode: getConfig("sell_only_mode", false) === true,
        maxPositions: Number(getConfig("max_open_positions", 5)),
        trailingStartPct: Number(getConfig("trailing_start_pct", 3)),
        stopLossPct: Number(getConfig("stop_loss_pct", 15)),
        minBalanceSol: Number(getConfig("min_balance_sol", 0.1)),
        enabledStrategies: (strategiesRes.data || []).filter((s: any) => s.enabled).map((s: any) => s.name),
        taStrategies: taEnabled,
        recentErrors: notifications.map((n: any) => ({
          time: new Date(n.created_at).toLocaleTimeString("pl-PL"),
          message: n.message?.slice(0, 120) || "",
          type: n.type,
        })),
        criticalIssues,
        sellFailures24h,
        sellSuccesses24h,
        deadTokensToday,
      });
    } catch (err) {
      console.error("Diagnostics load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDiagnostics(); }, [loadDiagnostics]);

  // Auto-refresh co 30 sekund
  useEffect(() => {
    const interval = setInterval(loadDiagnostics, 30000);
    return () => clearInterval(interval);
  }, [loadDiagnostics]);

  if (loading || !data) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Ładowanie diagnostyki...</p>
        </CardContent>
      </Card>
    );
  }

  const StatusDot = ({ ok }: { ok: boolean }) => (
    <div className={`w-2 h-2 rounded-full ${ok ? "bg-primary" : "bg-destructive"} ${ok ? "pulse-neon" : ""}`} />
  );

  const reasonLabels: Record<string, { icon: string; color: string }> = {
    stop_loss: { icon: "🔴", color: "text-destructive" },
    trailing_stop: { icon: "🟡", color: "text-neon-amber" },
    time_decay: { icon: "⏰", color: "text-muted-foreground" },
    fast_loss_cut: { icon: "⚡", color: "text-neon-red" },
    no_tokens: { icon: "🔻", color: "text-muted-foreground" },
    max_hold_time: { icon: "⏳", color: "text-muted-foreground" },
    dead_token: { icon: "💀", color: "text-destructive" },
    unsellable_dust: { icon: "🧹", color: "text-muted-foreground" },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Diagnostyka Systemu
        </h2>
        <Button size="sm" variant="outline" onClick={loadDiagnostics} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          Odśwież
        </Button>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-border bg-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              {data.botRunning ? <Wifi className="h-4 w-4 text-primary" /> : <WifiOff className="h-4 w-4 text-destructive" />}
              <span className="text-xs text-muted-foreground">Bot Status</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusDot ok={data.botRunning || data.lastRunStatus === "completed"} />
              <span className="text-sm font-bold text-foreground">
                {data.botRunning ? "Aktywny" : data.lastRunStatus === "completed" ? "OK" : "Błąd"}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {data.runsLast1h} cykli/h | {data.errorsLast1h} błędów
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Pozycje</span>
            </div>
            <div className="text-sm font-bold text-foreground">
              {data.openPositions} otwarte / {data.closedToday} zamknięte
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Max: {data.maxPositions} | {data.sellOnlyMode ? "🔴 SELL ONLY" : "🟢 BUY+SELL"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-neon-amber" />
              <span className="text-xs text-muted-foreground">Sygnały dziś</span>
            </div>
            <div className="text-sm font-bold text-foreground">
              ✅ {data.executedToday} | ⏳ {data.pendingSignals} | ❌ {data.rejectedToday}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Expired: {data.expiredToday}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">PnL dziś</span>
            </div>
            <div className={`text-sm font-bold ${data.totalPnlToday >= 0 ? "text-primary" : "text-destructive"}`}>
              {data.totalPnlToday >= 0 ? "+" : ""}{data.totalPnlToday.toFixed(1)}% łącznie
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              WR: {data.winRate.toFixed(0)}% | Avg: {data.avgPnl.toFixed(1)}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Config & Exit Reasons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Active Config */}
        <Card className="border-border bg-card">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Aktywna Konfiguracja
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Stop Loss</span>
                <span className="font-mono text-foreground">-{data.stopLossPct}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Trailing Start</span>
                <span className="font-mono text-foreground">+{data.trailingStartPct}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Trailing Stop</span>
                <span className="font-mono text-foreground">20% od ATH</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Time Decay</span>
                <span className="font-mono text-foreground">180 min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Min Balance</span>
                <span className="font-mono text-foreground">{data.minBalanceSol} SOL</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tryb</span>
                <Badge variant={data.sellOnlyMode ? "destructive" : "default"} className="text-[10px]">
                  {data.sellOnlyMode ? "SELL ONLY" : "BUY + SELL"}
                </Badge>
              </div>
              <div className="border-t border-border pt-2 mt-2">
                <span className="text-muted-foreground">Strategie TA:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {data.taStrategies.length > 0 ? data.taStrategies.map(s => (
                    <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                  )) : <span className="text-muted-foreground text-[10px]">Brak aktywnych</span>}
                </div>
              </div>
              <div className="border-t border-border pt-2">
                <span className="text-muted-foreground">Strategie handlowe:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {data.enabledStrategies.length > 0 ? data.enabledStrategies.map(s => (
                    <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                  )) : <span className="text-muted-foreground text-[10px]">Brak aktywnych</span>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Exit Reasons */}
        <Card className="border-border bg-card">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Timer className="h-4 w-4 text-neon-amber" />
              Powody Zamknięć (dziś)
            </h3>
            {Object.keys(data.closedReasons).length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Brak zamkniętych pozycji dziś</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(data.closedReasons).sort(([,a], [,b]) => b - a).map(([reason, count]) => {
                  const meta = reasonLabels[reason] || { icon: "❓", color: "text-muted-foreground" };
                  return (
                    <div key={reason} className="flex items-center justify-between text-xs">
                      <span className={`${meta.color}`}>
                        {meta.icon} {reason.replace(/_/g, " ")}
                      </span>
                      <span className="font-mono font-bold text-foreground">{count}x</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recent Errors */}
            {data.recentErrors.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <h4 className="text-xs font-semibold text-destructive mb-2 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Błędy (ostatnia godzina)
                </h4>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {data.recentErrors.map((err, i) => (
                    <div key={i} className="text-[10px] text-muted-foreground p-1.5 rounded bg-destructive/5">
                      <span className="text-destructive font-mono">{err.time}</span> — {err.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
