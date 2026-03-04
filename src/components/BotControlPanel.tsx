import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Power, Plus, Trash2, RefreshCw, Clock, CheckCircle2, XCircle,
  AlertTriangle, Activity, Loader2, Wifi, WifiOff, Settings2
} from "lucide-react";

interface BotRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  wallets_scanned: number;
  tokens_found: number;
  signals_generated: number;
  buy_signals: number;
  error_message: string | null;
  duration_ms: number | null;
}

export default function BotControlPanel() {
  const [botEnabled, setBotEnabled] = useState(false);
  const [trackedWallets, setTrackedWallets] = useState<string[]>([]);
  const [newWallet, setNewWallet] = useState("");
  const [minScore, setMinScore] = useState(70);
  const [maxPosition, setMaxPosition] = useState(0.1);
  const [savedMinScore, setSavedMinScore] = useState(70);
  const [savedMaxPosition, setSavedMaxPosition] = useState(0.1);
  const [recentRuns, setRecentRuns] = useState<BotRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data: configs } = await supabase.from("bot_config").select("*");
      if (configs) {
        for (const c of configs) {
          switch (c.key) {
            case "bot_enabled": setBotEnabled(c.value === true); break;
            case "tracked_wallets": setTrackedWallets(c.value as string[] || []); break;
            case "min_score_threshold": { const v = c.value as number || 70; setMinScore(v); setSavedMinScore(v); break; }
            case "max_position_sol": { const v = c.value as number || 0.1; setMaxPosition(v); setSavedMaxPosition(v); break; }
          }
        }
      }

      const { data: runs } = await supabase
        .from("bot_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(20);
      if (runs) setRecentRuns(runs as BotRun[]);
    } catch (e: any) {
      toast({ title: "Błąd", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // Auto-refresh runs every 30s
  useEffect(() => {
    const interval = setInterval(async () => {
      const { data: runs } = await supabase
        .from("bot_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(20);
      if (runs) setRecentRuns(runs as BotRun[]);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  async function updateConfig(key: string, value: any) {
    const { error } = await supabase
      .from("bot_config")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw error;
  }

  async function handleToggleBot(enabled: boolean) {
    setSaving(true);
    try {
      await updateConfig("bot_enabled", enabled);
      setBotEnabled(enabled);
      toast({
        title: enabled ? "🟢 Bot aktywowany!" : "🔴 Bot zatrzymany",
        description: enabled
          ? "Bot skanuje portfele co minutę w tle"
          : "Bot nie będzie generował nowych sygnałów",
      });
    } catch (e: any) {
      toast({ title: "Błąd", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function addWallet() {
    const addr = newWallet.trim();
    if (!addr || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) {
      toast({ title: "Nieprawidłowy adres", description: "Podaj poprawny adres Solana", variant: "destructive" });
      return;
    }
    if (trackedWallets.includes(addr)) {
      toast({ title: "Już dodany", description: "Ten portfel jest już na liście", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const updated = [...trackedWallets, addr];
      await updateConfig("tracked_wallets", updated);
      setTrackedWallets(updated);
      setNewWallet("");
      toast({ title: "✅ Portfel dodany" });
    } catch (e: any) {
      toast({ title: "Błąd", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function removeWallet(addr: string) {
    setSaving(true);
    try {
      const updated = trackedWallets.filter((w) => w !== addr);
      await updateConfig("tracked_wallets", updated);
      setTrackedWallets(updated);
      toast({ title: "Portfel usunięty" });
    } catch (e: any) {
      toast({ title: "Błąd", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    try {
      await Promise.all([
        updateConfig("min_score_threshold", minScore),
        updateConfig("max_position_sol", maxPosition),
      ]);
      setSavedMinScore(minScore);
      setSavedMaxPosition(maxPosition);
      toast({ title: "✅ Ustawienia zapisane" });
    } catch (e: any) {
      toast({ title: "Błąd", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function triggerManualRun() {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("bot-monitor", {
        body: { manual: true },
      });
      if (error) throw error;
      toast({
        title: "Skan zakończony",
        description: `Portfele: ${data?.wallets_scanned || 0}, Tokeny: ${data?.tokens_found || 0}, Sygnały BUY: ${data?.buy_signals || 0}`,
      });
      loadConfig();
    } catch (e: any) {
      toast({ title: "Błąd skanu", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // Stats from recent runs
  const last24h = recentRuns.filter(
    (r) => new Date(r.started_at).getTime() > Date.now() - 86400000
  );
  const totalScans24h = last24h.length;
  const totalSignals24h = last24h.reduce((s, r) => s + (r.signals_generated || 0), 0);
  const totalErrors24h = last24h.filter((r) => r.status === "error").length;
  const avgDuration = last24h.length > 0
    ? Math.round(last24h.reduce((s, r) => s + (r.duration_ms || 0), 0) / last24h.length)
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Bot Status Header */}
      <Card className="border-border bg-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${botEnabled ? "bg-primary/15" : "bg-muted/50"}`}>
                {botEnabled ? (
                  <Wifi className="h-6 w-6 text-primary animate-pulse" />
                ) : (
                  <WifiOff className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  Bot 24/7
                  <Badge variant={botEnabled ? "default" : "secondary"}>
                    {botEnabled ? "AKTYWNY" : "WYŁĄCZONY"}
                  </Badge>
                </h2>
                <p className="text-xs text-muted-foreground">
                  {botEnabled
                    ? `Skanuje ${trackedWallets.length} portfeli co minutę`
                    : "Włącz bota aby monitorować portfele automatycznie"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={triggerManualRun}
                disabled={saving}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span className="ml-1.5 hidden sm:inline">Skanuj teraz</span>
              </Button>
              <Switch
                checked={botEnabled}
                onCheckedChange={handleToggleBot}
                disabled={saving}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats 24h */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat icon={Activity} label="Skany 24h" value={totalScans24h} />
        <MiniStat icon={CheckCircle2} label="Sygnały 24h" value={totalSignals24h} />
        <MiniStat icon={AlertTriangle} label="Błędy 24h" value={totalErrors24h} />
        <MiniStat icon={Clock} label="Śr. czas (ms)" value={avgDuration} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Tracked Wallets */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Śledzone portfele ({trackedWallets.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Adres portfela Solana..."
                value={newWallet}
                onChange={(e) => setNewWallet(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addWallet()}
                className="text-xs font-mono"
              />
              <Button size="sm" onClick={addWallet} disabled={saving}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {trackedWallets.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Brak śledzonych portfeli. Dodaj adres smart money.
                </p>
              ) : (
                trackedWallets.map((w) => (
                  <div key={w} className="flex items-center justify-between bg-muted/30 rounded px-2.5 py-1.5">
                    <span className="text-[11px] font-mono text-foreground truncate mr-2">
                      {w.slice(0, 6)}...{w.slice(-4)}
                    </span>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeWallet(w)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Settings */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              Ustawienia bota
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Min. score do KUP (0-100)
              </label>
              <Input
                type="number"
                min={0}
                max={100}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Max pozycja (SOL)
              </label>
              <Input
                type="number"
                min={0.01}
                step={0.01}
                value={maxPosition}
                onChange={(e) => setMaxPosition(Number(e.target.value))}
              />
            </div>
            {(minScore !== savedMinScore || maxPosition !== savedMaxPosition) && (
              <p className="text-[10px] text-neon-amber">⚠ Niezapisane zmiany</p>
            )}
            <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2">
              Zapisane: score <span className="text-foreground font-medium">{savedMinScore}</span>, pozycja <span className="text-foreground font-medium">{savedMaxPosition} SOL</span>
            </div>
            <Button onClick={saveSettings} disabled={saving} className="w-full" size="sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Zapisz ustawienia
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Run History */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Historia uruchomień
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={loadConfig}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {recentRuns.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                Brak historii — bot jeszcze nie skanował
              </p>
            ) : (
              recentRuns.map((run) => (
                <RunRow key={run.id} run={run} />
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3 flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-primary shrink-0" />
        <div>
          <p className="text-lg font-bold text-foreground">{value}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function RunRow({ run }: { run: BotRun }) {
  const statusConfig: Record<string, { icon: any; color: string; label: string }> = {
    completed: { icon: CheckCircle2, color: "text-primary", label: "OK" },
    error: { icon: XCircle, color: "text-destructive", label: "Błąd" },
    running: { icon: Loader2, color: "text-neon-amber", label: "W toku" },
    skipped: { icon: Power, color: "text-muted-foreground", label: "Pominięty" },
  };

  const cfg = statusConfig[run.status] || statusConfig.completed;
  const Icon = cfg.icon;
  const time = new Date(run.started_at).toLocaleString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });

  return (
    <div className="flex items-center justify-between bg-muted/20 rounded px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${cfg.color} ${run.status === "running" ? "animate-spin" : ""}`} />
        <span className="text-muted-foreground">{time}</span>
      </div>
      <div className="flex items-center gap-3">
        {run.status === "completed" && (
          <>
            <span className="text-muted-foreground">
              {run.wallets_scanned} portfeli
            </span>
            <span className="text-muted-foreground">
              {run.tokens_found} tokenów
            </span>
            {run.buy_signals > 0 && (
              <Badge variant="default" className="text-[9px] px-1.5 py-0">
                {run.buy_signals} BUY
              </Badge>
            )}
          </>
        )}
        {run.status === "error" && (
          <span className="text-destructive truncate max-w-[200px]" title={run.error_message || ""}>
            {run.error_message?.slice(0, 40)}
          </span>
        )}
        {run.duration_ms && (
          <span className="text-muted-foreground">{run.duration_ms}ms</span>
        )}
      </div>
    </div>
  );
}
