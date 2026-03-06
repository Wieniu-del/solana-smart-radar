import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  HeartPulse, RefreshCw, CheckCircle2, AlertTriangle, XCircle,
  Power, Cpu, Globe, Wallet, Clock, Activity, Zap
} from "lucide-react";

interface HealthData {
  status: "healthy" | "degraded" | "critical" | "offline";
  checked_at: string;
  uptime: {
    bot_running: boolean;
    bot_enabled: boolean;
    last_run_at: string | null;
    last_run_status: string;
    last_run_duration_ms: number | null;
  };
  performance: {
    runs_last_hour: number;
    errors_last_hour: number;
    error_rate_pct: number;
    avg_duration_ms: number;
  };
  infrastructure: {
    rpc_healthy: boolean;
    rpc_latency_ms: number;
    jupiter_healthy: boolean;
    helius_key_set: boolean;
    wallet_key_set: boolean;
  };
  positions: {
    open_count: number;
    stale_count: number;
  };
  alerts: { level: string; message: string; timestamp: string }[];
}

const statusConfig = {
  healthy: { color: "text-primary", bg: "bg-primary/10", border: "border-primary/30", label: "HEALTHY", icon: CheckCircle2 },
  degraded: { color: "text-neon-amber", bg: "bg-neon-amber/10", border: "border-neon-amber/30", label: "DEGRADED", icon: AlertTriangle },
  critical: { color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/30", label: "CRITICAL", icon: XCircle },
  offline: { color: "text-muted-foreground", bg: "bg-muted/10", border: "border-border", label: "OFFLINE", icon: Power },
};

export default function BotHealthMonitor() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("bot-health");
      if (fnErr) throw fnErr;
      setHealth(data as HealthData);
    } catch (e: any) {
      setError(e.message || "Błąd sprawdzania zdrowia");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 60_000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const cfg = health ? statusConfig[health.status] : statusConfig.offline;
  const StatusIcon = cfg.icon;

  const timeSince = (iso: string | null) => {
    if (!iso) return "—";
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return `${Math.round(diff / 1000)}s temu`;
    if (diff < 3600_000) return `${Math.round(diff / 60_000)}m temu`;
    return `${Math.round(diff / 3600_000)}h temu`;
  };

  return (
    <Card className={`neon-card border ${cfg.border} relative overflow-hidden`}>
      {/* Pulse indicator */}
      {health?.status === "healthy" && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary opacity-60"
          style={{ animation: "pulse 2s ease-in-out infinite" }} />
      )}

      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HeartPulse className={`h-4 w-4 ${cfg.color} ${health?.status === "healthy" ? "animate-pulse" : ""}`} />
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Bot Health</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`${cfg.color} ${cfg.bg} ${cfg.border} text-[10px] font-black`}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {cfg.label}
            </Badge>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchHealth} disabled={loading}>
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {error && (
          <p className="text-[10px] text-destructive font-mono">{error}</p>
        )}

        {health && (
          <>
            {/* Quick metrics grid */}
            <div className="grid grid-cols-3 gap-2">
              <MetricBox
                icon={Clock}
                label="Ostatni run"
                value={timeSince(health.uptime.last_run_at)}
                ok={health.uptime.bot_running}
              />
              <MetricBox
                icon={Activity}
                label="Runy/h"
                value={String(health.performance.runs_last_hour)}
                ok={health.performance.runs_last_hour > 0}
              />
              <MetricBox
                icon={Zap}
                label="Błędy"
                value={`${health.performance.error_rate_pct}%`}
                ok={health.performance.error_rate_pct < 30}
              />
            </div>

            {/* Infrastructure */}
            <div className="flex flex-wrap gap-1.5">
              <InfraChip label="RPC" ok={health.infrastructure.rpc_healthy}
                detail={health.infrastructure.rpc_latency_ms > 0 ? `${health.infrastructure.rpc_latency_ms}ms` : undefined} />
              <InfraChip label="Jupiter" ok={health.infrastructure.jupiter_healthy} />
              <InfraChip label="Helius Key" ok={health.infrastructure.helius_key_set} />
              <InfraChip label="Wallet Key" ok={health.infrastructure.wallet_key_set} />
              <InfraChip label={`${health.positions.open_count} pozycji`}
                ok={health.positions.stale_count === 0}
                detail={health.positions.stale_count > 0 ? `${health.positions.stale_count} stale` : undefined} />
            </div>

            {/* Alerts */}
            {health.alerts.length > 0 && (
              <div className="space-y-1">
                {health.alerts.slice(0, 3).map((alert, i) => (
                  <div key={i} className={`text-[10px] font-mono px-2 py-1 rounded flex items-start gap-1.5 ${
                    alert.level === "critical"
                      ? "bg-destructive/10 text-destructive border border-destructive/20"
                      : "bg-neon-amber/10 text-neon-amber border border-neon-amber/20"
                  }`}>
                    {alert.level === "critical" ? <XCircle className="h-3 w-3 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />}
                    <span>{alert.message}</span>
                  </div>
                ))}
              </div>
            )}

            {health.alerts.length === 0 && health.status === "healthy" && (
              <p className="text-[10px] text-primary font-mono flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Wszystkie systemy działają prawidłowo
              </p>
            )}

            <p className="text-[9px] text-muted-foreground text-right">
              Sprawdzono: {timeSince(health.checked_at)}
            </p>
          </>
        )}

        {!health && !error && loading && (
          <div className="flex items-center justify-center py-4 gap-2 text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span className="text-xs">Sprawdzanie zdrowia...</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricBox({ icon: Icon, label, value, ok }: {
  icon: React.ElementType; label: string; value: string; ok: boolean;
}) {
  return (
    <div className={`rounded-lg p-2 border text-center ${
      ok ? "border-primary/20 bg-primary/5" : "border-destructive/20 bg-destructive/5"
    }`}>
      <Icon className={`h-3 w-3 mx-auto mb-0.5 ${ok ? "text-primary" : "text-destructive"}`} />
      <p className={`text-sm font-bold font-mono ${ok ? "text-foreground" : "text-destructive"}`}>{value}</p>
      <p className="text-[9px] text-muted-foreground">{label}</p>
    </div>
  );
}

function InfraChip({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${
      ok ? "border-primary/20 text-primary bg-primary/5" : "border-destructive/20 text-destructive bg-destructive/5"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-primary" : "bg-destructive"}`} />
      {label}
      {detail && <span className="opacity-60">({detail})</span>}
    </span>
  );
}
