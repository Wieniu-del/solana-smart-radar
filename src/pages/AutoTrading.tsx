import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import BotControlPanel from "@/components/BotControlPanel";
import PnLDashboard from "@/components/PnLDashboard";
import SystemStatusPanel from "@/components/SystemStatusPanel";
import PipelineConfigPanel from "@/components/PipelineConfigPanel";
import TechnicalStrategiesPanel from "@/components/TechnicalStrategiesPanel";
import SignalDiagnostics from "@/components/SignalDiagnostics";
import DiscoverySourcesPanel from "@/components/DiscoverySourcesPanel";
import SniperLiveFeed from "@/components/SniperLiveFeed";
import {
  Bot, Zap, TrendingUp, TrendingDown, Clock, AlertTriangle,
  CheckCircle2, XCircle, Target, Play, Filter, Loader2, BarChart3, Eye
} from "lucide-react";
import {
  getStrategies, toggleStrategy, getRecentSignals, updateSignalStatus,
  type StrategyConfig
} from "@/services/tradingEngine";
import {
  runPipeline, savePipelineSignals, type PipelineResult
} from "@/services/botPipeline";
import { getHeliusApiKey } from "@/services/helius";

export default function AutoTrading() {
  const [strategies, setStrategies] = useState<StrategyConfig[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [pipelineResults, setPipelineResults] = useState<PipelineResult[]>([]);
  const { toast } = useToast();
  const lastNoWalletToastAtRef = useRef(0);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [strats, sigs] = await Promise.all([getStrategies(), getRecentSignals()]);
      setStrategies(strats);
      setSignals(sigs);
    } catch (e: any) {
      toast({ title: "Błąd", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    try {
      await toggleStrategy(id, enabled);
      setStrategies((prev) => prev.map((s) => s.id === id ? { ...s, enabled } : s));
      toast({ title: enabled ? "Strategia aktywowana" : "Strategia wyłączona" });
    } catch (e: any) {
      toast({ title: "Błąd", description: e.message, variant: "destructive" });
    }
  }

  async function handleSignalAction(id: string, action: "approved" | "rejected") {
    try {
      await updateSignalStatus(id, action);
      setSignals((prev) => prev.map((s) => s.id === id ? { ...s, status: action } : s));
      toast({ title: action === "approved" ? "✅ Sygnał zatwierdzony" : "❌ Sygnał odrzucony" });
    } catch (e: any) {
      toast({ title: "Błąd", description: e.message, variant: "destructive" });
    }
  }

  const runBotScan = useCallback(async () => {
    if (!getHeliusApiKey()) {
      toast({ title: "Brak klucza API", description: "Dodaj klucz Helius w Ustawieniach", variant: "destructive" });
      return;
    }

    const normalizeWallets = (value: unknown): string[] => {
      const walletRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
      if (!Array.isArray(value)) return [];
      return Array.from(new Set(value.filter((w): w is string => typeof w === "string" && walletRegex.test(w.trim())).map((w) => w.trim())));
    };

    let trackedWallets: string[] = [];
    try {
      const stored = localStorage.getItem("tracked_wallets");
      if (stored) trackedWallets = normalizeWallets(JSON.parse(stored));
    } catch { }

    try {
      const { data } = await supabase.from("bot_config").select("value").eq("key", "tracked_wallets").maybeSingle();
      const dbWallets = normalizeWallets(data?.value);
      if (dbWallets.length > 0) {
        trackedWallets = dbWallets;
        localStorage.setItem("tracked_wallets", JSON.stringify(dbWallets));
      }
    } catch (e) {
      console.error("[Bot] Failed to fetch wallets from DB:", e);
    }

    if (trackedWallets.length === 0) {
      const now = Date.now();
      if (now - lastNoWalletToastAtRef.current > 15000) {
        toast({ title: "Brak portfeli", description: "Dodaj śledzone portfele w panelu bota", variant: "destructive" });
        lastNoWalletToastAtRef.current = now;
      }
      return;
    }

    setScanning(true);
    try {
      const results = await runPipeline(trackedWallets);
      setPipelineResults(results);
      await savePipelineSignals(results);
      const sigs = await getRecentSignals();
      setSignals(sigs);

      const buyCount = results.filter((r) => r.decision === "BUY").length;
      const watchCount = results.filter((r) => r.decision === "WATCH").length;
      const skipCount = results.filter((r) => r.decision === "SKIP").length;

      toast({
        title: `Skan zakończony — ${results.length} tokenów`,
        description: `🟢 KUP: ${buyCount} · 🟡 OBSERWUJ: ${watchCount} · 🔴 POMIŃ: ${skipCount}`
      });
    } catch (e: any) {
      toast({ title: "Błąd skanowania", description: e.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  }, [toast]);

  const pendingSignals = signals.filter((s) => s.status === "pending").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Auto Trading Bot</h1>
            <p className="text-sm text-muted-foreground">Skanowanie → Filtracja → Scoring → Egzekucja</p>
          </div>
        </div>
        <Button onClick={runBotScan} disabled={scanning} size="sm" className="bg-primary text-primary-foreground">
          {scanning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
          {scanning ? "Skanowanie..." : "Uruchom skan"}
        </Button>
      </div>

      <Tabs defaultValue="command" className="space-y-4">
        <TabsList className="bg-muted">
          <TabsTrigger value="command">
            <Bot className="h-3.5 w-3.5 mr-1" /> Kontrola
          </TabsTrigger>
          <TabsTrigger value="config">
            <Filter className="h-3.5 w-3.5 mr-1" /> Konfiguracja
          </TabsTrigger>
          <TabsTrigger value="signals-pnl">
            <Zap className="h-3.5 w-3.5 mr-1" /> Sygnały
            {pendingSignals > 0 && <span className="ml-1.5 bg-neon-amber/20 text-neon-amber text-[10px] px-1.5 py-0.5 rounded-full">{pendingSignals}</span>}
          </TabsTrigger>
          <TabsTrigger value="live">
            <Eye className="h-3.5 w-3.5 mr-1" /> Live Feed
          </TabsTrigger>
        </TabsList>

        {/* ═══ TAB 1: Kontrola ═══ */}
        <TabsContent value="command" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <BotControlPanel />
            </div>
            <div className="space-y-4">
              <DiscoverySourcesPanel />
              <SystemStatusPanel />
            </div>
          </div>
        </TabsContent>

        {/* ═══ TAB 2: Konfiguracja ═══ */}
        <TabsContent value="config" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PipelineConfigPanel />
            <TechnicalStrategiesPanel />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              Strategie ({strategies.length})
            </h3>
            <div className="space-y-2">
              {strategies.map((strategy) =>
                <Card key={strategy.id} className="border-border bg-card">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <div className={`p-1.5 rounded-lg ${strategy.signal_type === "BUY" ? "bg-primary/10" : "bg-destructive/10"}`}>
                          {strategy.signal_type === "BUY" ? <TrendingUp className="h-4 w-4 text-primary" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-foreground">{strategy.name}</span>
                            <Badge variant="outline" className="text-[10px]">{strategy.signal_type}</Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">{strategy.description}</p>
                          <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                            <span>Max: {strategy.max_position_sol} SOL</span>
                            {strategy.stop_loss_pct && <span>SL: {strategy.stop_loss_pct}%</span>}
                            {strategy.take_profit_pct && <span>TP: {strategy.take_profit_pct}%</span>}
                          </div>
                        </div>
                      </div>
                      <Switch checked={strategy.enabled} onCheckedChange={(checked) => handleToggle(strategy.id, checked)} />
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ═══ TAB 3: Sygnały & PnL ═══ */}
        <TabsContent value="signals-pnl" className="space-y-4">
          <Tabs defaultValue="pending" className="space-y-3">
            <TabsList className="bg-muted/50 h-8">
              <TabsTrigger value="pending" className="text-xs h-7">
                Oczekujące
                {pendingSignals > 0 && <span className="ml-1 bg-neon-amber/20 text-neon-amber text-[10px] px-1.5 py-0.5 rounded-full">{pendingSignals}</span>}
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs h-7">Historia</TabsTrigger>
              <TabsTrigger value="diagnostics" className="text-xs h-7">Diagnostyka</TabsTrigger>
              <TabsTrigger value="pnl" className="text-xs h-7">
                <BarChart3 className="h-3 w-3 mr-1" /> PnL
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="space-y-3">
              {signals.filter((s) => s.status === "pending").length === 0 ? (
                <Card className="border-border bg-card">
                  <CardContent className="p-8 text-center text-muted-foreground">
                    <Bot className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>Brak oczekujących sygnałów</p>
                  </CardContent>
                </Card>
              ) : (
                signals.filter((s) => s.status === "pending").map((signal) =>
                  <SignalCard key={signal.id} signal={signal} onAction={handleSignalAction} />
                )
              )}
            </TabsContent>

            <TabsContent value="history" className="space-y-3">
              {signals.filter((s) => s.status !== "pending").length === 0 ? (
                <Card className="border-border bg-card">
                  <CardContent className="p-8 text-center text-muted-foreground">
                    <Clock className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>Brak historii sygnałów</p>
                  </CardContent>
                </Card>
              ) : (
                signals.filter((s) => s.status !== "pending").map((signal) =>
                  <SignalCard key={signal.id} signal={signal} readonly />
                )
              )}
            </TabsContent>

            <TabsContent value="diagnostics">
              <SignalDiagnostics />
            </TabsContent>

            <TabsContent value="pnl">
              <PnLDashboard />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* ═══ TAB 4: Live Feed ═══ */}
        <TabsContent value="live" className="space-y-4">
          <SniperLiveFeed />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Signal Card ───
function SignalCard({ signal, onAction, readonly }: { signal: any; onAction?: (id: string, action: "approved" | "rejected") => void; readonly?: boolean; }) {
  const statusColors: Record<string, string> = {
    pending: "text-neon-amber bg-neon-amber/10 border-neon-amber/30",
    approved: "text-primary bg-primary/10 border-primary/30",
    rejected: "text-destructive bg-destructive/10 border-destructive/30",
    executed: "text-secondary bg-secondary/10 border-secondary/30",
    expired: "text-muted-foreground bg-muted/10 border-border",
  };

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {signal.signal_type === "BUY" ? <TrendingUp className="h-4 w-4 text-primary shrink-0" /> : <TrendingDown className="h-4 w-4 text-destructive shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-foreground">{signal.token_symbol || signal.token_name}</span>
                <Badge variant="outline" className="text-[10px]">{signal.signal_type}</Badge>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${statusColors[signal.status] || ""}`}>{signal.status}</span>
              </div>
              <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
                <span>📊 {signal.strategy}</span>
                <span>💪 {signal.confidence}%</span>
                {signal.smart_score && <span>🧠 {signal.smart_score}</span>}
                <span>{new Date(signal.created_at).toLocaleString("pl-PL")}</span>
              </div>
            </div>
          </div>
          {!readonly && signal.status === "pending" && onAction && (
            <div className="flex gap-1 shrink-0">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-primary hover:text-primary" onClick={() => onAction(signal.id, "approved")}>
                <CheckCircle2 className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => onAction(signal.id, "rejected")}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
