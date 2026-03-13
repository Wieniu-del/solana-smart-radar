import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart3, CheckCircle2, XCircle, Clock, RefreshCw, Loader2,
  TrendingUp, AlertTriangle, Shield, Droplets, Target, Zap
} from "lucide-react";

interface SignalStats {
  total: number;
  pending: number;
  executed: number;
  rejected: number;
  expired: number;
  approved: number;
}

interface RejectedSignal {
  id: string;
  token_symbol: string | null;
  token_mint: string;
  confidence: number;
  created_at: string;
  conditions: any;
  strategy: string;
}

export default function SignalDiagnostics() {
  const [stats, setStats] = useState<SignalStats>({ total: 0, pending: 0, executed: 0, rejected: 0, expired: 0, approved: 0 });
  const [rejectedSignals, setRejectedSignals] = useState<RejectedSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<"24h" | "7d" | "30d">("24h");

  const timeRangeMs = { "24h": 86400000, "7d": 604800000, "30d": 2592000000 };

  async function loadDiagnostics() {
    setLoading(true);
    const since = new Date(Date.now() - timeRangeMs[timeRange]).toISOString();

    const [allRes, rejectedRes] = await Promise.all([
      supabase
        .from("trading_signals")
        .select("status")
        .gte("created_at", since),
      supabase
        .from("trading_signals")
        .select("id, token_symbol, token_mint, confidence, created_at, conditions, strategy")
        .eq("status", "rejected")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (allRes.data) {
      const s: SignalStats = { total: allRes.data.length, pending: 0, executed: 0, rejected: 0, expired: 0, approved: 0 };
      for (const sig of allRes.data) {
        if (sig.status === "pending") s.pending++;
        else if (sig.status === "executed") s.executed++;
        else if (sig.status === "rejected") s.rejected++;
        else if (sig.status === "expired") s.expired++;
        else if (sig.status === "approved") s.approved++;
      }
      setStats(s);
    }

    if (rejectedRes.data) {
      setRejectedSignals(rejectedRes.data as RejectedSignal[]);
    }

    setLoading(false);
  }

  useEffect(() => { loadDiagnostics(); }, [timeRange]);

  const getRejectionReason = (signal: RejectedSignal): { label: string; icon: any; color: string } => {
    const c = signal.conditions as any || {};
    
    if (c.reject_reason) {
      return { label: c.reject_reason, icon: XCircle, color: "text-destructive" };
    }
    if (signal.confidence < 50) {
      return { label: `Niski score: ${signal.confidence}/100`, icon: Target, color: "text-neon-amber" };
    }
    if (c.security_score !== undefined && c.security_score < 30) {
      return { label: `Bezpieczeństwo: ${c.security_score}/100`, icon: Shield, color: "text-destructive" };
    }
    if (c.liquidity_score !== undefined && c.liquidity_score < 20) {
      return { label: `Niska płynność: $${c.value_usd?.toFixed(0) || "?"}`, icon: Droplets, color: "text-neon-amber" };
    }
    if (c.sentiment === "AVOID" || (c.sentiment_score !== undefined && c.sentiment_score < -50)) {
      return { label: `Negatywny sentiment: ${c.sentiment_score}`, icon: AlertTriangle, color: "text-destructive" };
    }
    // Duplicate / already open
    return { label: "Duplikat lub limit pozycji", icon: XCircle, color: "text-muted-foreground" };
  };

  const execRate = stats.total > 0 ? ((stats.executed / stats.total) * 100).toFixed(1) : "0";
  const rejectRate = stats.total > 0 ? ((stats.rejected / stats.total) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          Diagnostyka Sygnałów
        </h3>
        <div className="flex items-center gap-2">
          {(["24h", "7d", "30d"] as const).map((r) => (
            <Button
              key={r}
              size="sm"
              variant={timeRange === r ? "default" : "outline"}
              className="h-7 text-[10px] px-2"
              onClick={() => setTimeRange(r)}
            >
              {r}
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={loadDiagnostics} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <CounterCard label="Wygenerowane" value={stats.total} icon={Zap} color="text-primary" />
        <CounterCard label="Wykonane" value={stats.executed} icon={CheckCircle2} color="text-primary" />
        <CounterCard label="Oczekujące" value={stats.pending} icon={Clock} color="text-neon-amber" />
        <CounterCard label="Zatwierdzone" value={stats.approved} icon={TrendingUp} color="text-secondary" />
        <CounterCard label="Odrzucone" value={stats.rejected} icon={XCircle} color="text-destructive" />
        <CounterCard label="Wygasłe" value={stats.expired} icon={AlertTriangle} color="text-muted-foreground" />
      </div>

      {/* Rates */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border bg-card">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-black text-primary">{execRate}%</p>
            <p className="text-[10px] text-muted-foreground">Execution Rate</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-black text-destructive">{rejectRate}%</p>
            <p className="text-[10px] text-muted-foreground">Rejection Rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Rejected signals with reasons */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <XCircle className="h-4 w-4 text-destructive" />
            Odrzucone sygnały — powody ({rejectedSignals.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 max-h-[300px] overflow-y-auto">
          {rejectedSignals.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              Brak odrzuconych sygnałów w wybranym okresie
            </p>
          ) : (
            rejectedSignals.map((signal) => {
              const reason = getRejectionReason(signal);
              const ReasonIcon = reason.icon;
              return (
                <div key={signal.id} className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2">
                  <ReasonIcon className={`h-4 w-4 shrink-0 ${reason.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">
                        {signal.token_symbol || signal.token_mint.slice(0, 8)}
                      </span>
                      <Badge variant="outline" className="text-[9px]">
                        Score: {signal.confidence}
                      </Badge>
                      <span className="text-[9px] text-muted-foreground">
                        {new Date(signal.created_at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className={`text-[10px] ${reason.color}`}>{reason.label}</p>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CounterCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color} shrink-0`} />
        <div>
          <p className="text-lg font-bold text-foreground">{value}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
