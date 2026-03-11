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
import {
  Bot, Zap, ShieldAlert, TrendingUp, TrendingDown, Clock, AlertTriangle,
  CheckCircle2, XCircle, Activity, Target, DollarSign, Play, Square,
  Filter, Shield, Droplets, Users, Loader2, BarChart3
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
  const [botRunning, setBotRunning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pipelineResults, setPipelineResults] = useState<PipelineResult[]>([]);
  const { toast } = useToast();
  const lastNoWalletToastAtRef = useRef(0);

  useEffect(() => {
    loadData();
  }, []);

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
      setStrategies((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
      toast({ title: enabled ? "Strategia aktywowana" : "Strategia wyłączona" });
    } catch (e: any) {
      toast({ title: "Błąd", description: e.message, variant: "destructive" });
    }
  }

  async function handleSignalAction(id: string, action: "approved" | "rejected") {
    try {
      await updateSignalStatus(id, action);
      setSignals((prev) => prev.map((s) => (s.id === id ? { ...s, status: action } : s)));
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

    // Resolve tracked wallets from DB + localStorage (with strong fallback)
    const normalizeWallets = (value: unknown): string[] => {
      const walletRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
      if (!Array.isArray(value)) return [];
      return Array.from(new Set(value.filter((w): w is string => typeof w === "string" && walletRegex.test(w.trim())).map((w) => w.trim())));
    };

    let trackedWallets: string[] = [];

    try {
      const stored = localStorage.getItem("tracked_wallets");
      if (stored) {
        const parsed = JSON.parse(stored);
        trackedWallets = normalizeWallets(parsed);
      }
    } catch {
      // Ignore invalid localStorage format
    }

    try {
      const { data, error } = await supabase
        .from("bot_config")
        .select("value")
        .eq("key", "tracked_wallets")
        .maybeSingle();

      if (error) {
        console.warn("[Bot] tracked_wallets query warning:", error.message);
      }

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
        toast({ title: "Brak portfeli", description: "Dodaj śledzone portfele w Ustawieniach lub w panelu bota", variant: "destructive" });
        lastNoWalletToastAtRef.current = now;
      }
      return;
    }

    console.log("[Bot] Using", trackedWallets.length, "tracked wallets");

    setScanning(true);
    try {
      const results = await runPipeline(trackedWallets);
      setPipelineResults(results);

      // Save BUY signals to DB
      await savePipelineSignals(results);

      // Reload signals
      const sigs = await getRecentSignals();
      setSignals(sigs);

      const buyCount = results.filter(r => r.decision === "BUY").length;
      const watchCount = results.filter(r => r.decision === "WATCH").length;
      const skipCount = results.filter(r => r.decision === "SKIP").length;

      toast({
        title: `Skan zakończony — ${results.length} tokenów`,
        description: `🟢 KUP: ${buyCount} · 🟡 OBSERWUJ: ${watchCount} · 🔴 POMIŃ: ${skipCount}`,
      });
    } catch (e: any) {
      toast({ title: "Błąd skanowania", description: e.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  }, [toast]);

  const activeStrategies = strategies.filter((s) => s.enabled).length;
  const pendingSignals = signals.filter((s) => s.status === "pending").length;
  const buySignals = signals.filter((s) => s.signal_type === "BUY").length;
  const sellSignals = signals.filter((s) => s.signal_type === "SELL").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Auto Trading Bot</h1>
            <p className="text-sm text-muted-foreground">Pipeline: Detekcja → Bezpieczeństwo → Płynność → Smart Money → Scoring → Wykonanie</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={runBotScan}
            disabled={scanning}
            size="sm"
            className="bg-primary text-primary-foreground"
          >
            {scanning ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {scanning ? "Skanowanie..." : "Uruchom skan"}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={Target} label="Aktywne strategie" value={activeStrategies} color="text-primary" />
        <StatCard icon={Zap} label="Sygnały łącznie" value={signals.length} color="text-secondary" />
        <StatCard icon={TrendingUp} label="Sygnały BUY" value={buySignals} color="text-primary" />
        <StatCard icon={TrendingDown} label="Sygnały SELL" value={sellSignals} color="text-destructive" />
        <StatCard icon={AlertTriangle} label="Oczekujące" value={pendingSignals} color="text-neon-amber" />
      </div>

      {/* Pipeline Visualization */}
      <Card className="border-border bg-card">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            Pipeline Decyzyjny Bota
          </h3>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {[
              { icon: Users, label: "Detekcja tokenów", desc: "Smart wallets" },
              { icon: Shield, label: "Bezpieczeństwo", desc: "Rugpull scan" },
              { icon: Droplets, label: "Płynność", desc: "LP + Volume" },
              { icon: Activity, label: "Aktywność portfeli", desc: "Smart Money" },
              { icon: Target, label: "Scoring", desc: "70+ = KUP" },
              { icon: Zap, label: "Jupiter DEX", desc: "Wykonanie" },
              { icon: ShieldAlert, label: "Risk Manager", desc: "SL/TP/Trail" },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-2 shrink-0">
                <div className="flex flex-col items-center gap-1 bg-muted/30 rounded-lg px-3 py-2 min-w-[90px]">
                  <step.icon className="h-4 w-4 text-primary" />
                  <span className="text-[10px] font-semibold text-foreground text-center">{step.label}</span>
                  <span className="text-[9px] text-muted-foreground">{step.desc}</span>
                </div>
                {i < 6 && <span className="text-muted-foreground text-lg">→</span>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="bot247" className="space-y-4">
        <TabsList className="bg-muted">
          <TabsTrigger value="bot247">
            🤖 Bot 24/7
          </TabsTrigger>
          <TabsTrigger value="pipeline">
            Wyniki Pipeline
            {pipelineResults.length > 0 && (
              <span className="ml-1.5 bg-primary/20 text-primary text-[10px] px-1.5 py-0.5 rounded-full">
                {pipelineResults.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="strategies">Strategie</TabsTrigger>
          <TabsTrigger value="signals">
            Sygnały
            {pendingSignals > 0 && (
              <span className="ml-1.5 bg-neon-amber/20 text-neon-amber text-[10px] px-1.5 py-0.5 rounded-full">
                {pendingSignals}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">Historia</TabsTrigger>
          <TabsTrigger value="pnl">
            <BarChart3 className="h-3.5 w-3.5 mr-1" />
            PnL
          </TabsTrigger>
          <TabsTrigger value="tech-strategies">
            <TrendingUp className="h-3.5 w-3.5 mr-1" />
            Strategie TA
          </TabsTrigger>
          <TabsTrigger value="pipeline-config">
            <Filter className="h-3.5 w-3.5 mr-1" />
            Pipeline
          </TabsTrigger>
          <TabsTrigger value="status">
            <Activity className="h-3.5 w-3.5 mr-1" />
            Status
          </TabsTrigger>
        </TabsList>

        {/* ─── Bot 24/7 Control Panel ─── */}
        <TabsContent value="bot247">
          <BotControlPanel />
        </TabsContent>

        {/* ─── Pipeline Config Tab ─── */}
        <TabsContent value="pipeline-config">
          <PipelineConfigPanel />
        </TabsContent>

        {/* ─── Pipeline Results Tab ─── */}
        <TabsContent value="pipeline" className="space-y-3">
          {pipelineResults.length === 0 ? (
            <Card className="border-border bg-card">
              <CardContent className="p-8 text-center text-muted-foreground">
                <Bot className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Brak wyników pipeline</p>
                <p className="text-xs mt-1">Kliknij "Uruchom skan" aby przeskanować śledzone portfele</p>
              </CardContent>
            </Card>
          ) : (
            pipelineResults.map((result, i) => (
              <PipelineResultCard key={`${result.token.mint}-${i}`} result={result} />
            ))
          )}
        </TabsContent>

        {/* ─── Strategies Tab ─── */}
        <TabsContent value="strategies" className="space-y-4">
          {strategies.map((strategy) => (
            <Card key={strategy.id} className="border-border bg-card">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div className={`p-2 rounded-lg ${strategy.signal_type === "BUY" ? "bg-primary/10" : "bg-destructive/10"}`}>
                      {strategy.signal_type === "BUY" ? (
                        <TrendingUp className="h-5 w-5 text-primary" />
                      ) : (
                        <TrendingDown className="h-5 w-5 text-destructive" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{strategy.name}</span>
                        <Badge variant="outline" className="text-[10px]">{strategy.signal_type}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{strategy.description}</p>
                      <div className="flex gap-3 mt-2 text-[10px] text-muted-foreground">
                        <span>Max: {strategy.max_position_sol} SOL</span>
                        {strategy.stop_loss_pct && <span>SL: {strategy.stop_loss_pct}%</span>}
                        {strategy.take_profit_pct && <span>TP: {strategy.take_profit_pct}%</span>}
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={strategy.enabled}
                    onCheckedChange={(checked) => handleToggle(strategy.id, checked)}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ─── Signals Tab ─── */}
        <TabsContent value="signals" className="space-y-3">
          {signals.filter((s) => s.status === "pending").length === 0 ? (
            <Card className="border-border bg-card">
              <CardContent className="p-8 text-center text-muted-foreground">
                <Bot className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Brak oczekujących sygnałów</p>
                <p className="text-xs mt-1">Uruchom skan pipeline lub przeanalizuj portfel</p>
              </CardContent>
            </Card>
          ) : (
            signals
              .filter((s) => s.status === "pending")
              .map((signal) => <SignalCard key={signal.id} signal={signal} onAction={handleSignalAction} />)
          )}
        </TabsContent>

        {/* ─── History Tab ─── */}
        <TabsContent value="history" className="space-y-3">
          {signals.filter((s) => s.status !== "pending").length === 0 ? (
            <Card className="border-border bg-card">
              <CardContent className="p-8 text-center text-muted-foreground">
                <Clock className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Brak historii sygnałów</p>
              </CardContent>
            </Card>
          ) : (
            signals
              .filter((s) => s.status !== "pending")
              .map((signal) => <SignalCard key={signal.id} signal={signal} readonly />)
          )}
        </TabsContent>

        {/* ─── PnL Dashboard Tab ─── */}
        <TabsContent value="pnl">
          <PnLDashboard />
        </TabsContent>

        {/* ─── System Status Tab ─── */}
        <TabsContent value="status">
          <SystemStatusPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Pipeline Result Card ───

function PipelineResultCard({ result }: { result: PipelineResult }) {
  const decisionColors = {
    BUY: "bg-primary/10 text-primary border-primary/30",
    WATCH: "bg-neon-amber/10 text-neon-amber border-neon-amber/30",
    SKIP: "bg-destructive/10 text-destructive border-destructive/30",
  };

  const decisionLabels = { BUY: "🟢 KUP", WATCH: "🟡 OBSERWUJ", SKIP: "🔴 POMIŃ" };

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
             <span className="font-bold text-foreground text-xl">{result.token.symbol}</span>
              {result.token.name && result.token.name !== result.token.symbol && (
                <span className="text-sm text-muted-foreground">({result.token.name})</span>
              )}
              <Badge className={`${decisionColors[result.decision]} text-sm px-3 py-1`}>
                {decisionLabels[result.decision]}
              </Badge>
              <Badge variant="outline" className="text-xs px-2 py-0.5">
                Score: {result.totalScore}/100
              </Badge>
              <Badge variant="outline" className="text-xs px-2 py-0.5">
                {result.token.source === "smart_wallet" ? "Smart Money" :
                 result.token.source === "whale_buy" ? "Wieloryb" : "Nowa para"}
              </Badge>
            </div>

            <p className="text-sm font-mono text-muted-foreground mb-1 truncate">{result.token.mint}</p>
            <p className="text-sm text-muted-foreground mb-3">
              Sygnał: {new Date(result.timestamp).toLocaleDateString("pl-PL")} · {new Date(result.timestamp).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>

            {/* Score breakdown */}
            <div className="grid grid-cols-3 gap-3 mb-3">
              <ScoreBreakdownItem
                icon={Shield}
                label="Bezpieczeństwo"
                score={result.securityScore}
                color={result.securityScore >= 60 ? "text-primary" : result.securityScore >= 30 ? "text-neon-amber" : "text-destructive"}
              />
              <ScoreBreakdownItem
                icon={Droplets}
                label="Płynność"
                score={result.liquidityScore}
                color={result.liquidityScore >= 60 ? "text-primary" : result.liquidityScore >= 30 ? "text-neon-amber" : "text-destructive"}
              />
              <ScoreBreakdownItem
                icon={Users}
                label="Smart Money"
                score={result.walletScore}
                color={result.walletScore >= 50 ? "text-primary" : result.walletScore >= 25 ? "text-neon-amber" : "text-destructive"}
              />
            </div>

            {/* Wallet data */}
            <div className="flex gap-4 text-xs text-muted-foreground mb-2">
              <span>Smart wallets kupujące: {result.walletData.smartWalletsBuying}</span>
              <span>Wieloryby kupujące: {result.walletData.whaleWalletsBuying}</span>
              <span>Łącznie kupujących: {result.walletData.totalBuyers}</span>
            </div>

            {/* Reasons */}
            <div className="space-y-0.5">
              {result.reasons.map((reason, i) => (
                <p key={i} className="text-xs text-muted-foreground">{reason}</p>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreBreakdownItem({ icon: Icon, label, score, color }: {
  icon: any; label: string; score: number; color: string;
}) {
  return (
    <div className="bg-muted/30 rounded-lg p-2 text-center">
      <Icon className={`h-5 w-5 mx-auto mb-1 ${color}`} />
      <p className={`text-2xl font-bold ${color}`}>{score}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3 flex items-center gap-3">
        <Icon className={`h-4 w-4 ${color}`} />
        <div>
          <p className="text-xl font-bold text-foreground">{value}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SignalCard({
  signal,
  onAction,
  readonly = false,
}: {
  signal: any;
  onAction?: (id: string, action: "approved" | "rejected") => void;
  readonly?: boolean;
}) {
  const isBuy = signal.signal_type === "BUY";
  const statusColors: Record<string, string> = {
    pending: "bg-neon-amber/10 text-neon-amber border-neon-amber/30",
    approved: "bg-primary/10 text-primary border-primary/30",
    rejected: "bg-destructive/10 text-destructive border-destructive/30",
    executed: "bg-secondary/10 text-secondary border-secondary/30",
    expired: "bg-muted text-muted-foreground border-border",
  };
  const fallbackToken = signal.token_mint ? `${signal.token_mint.slice(0, 4)}...${signal.token_mint.slice(-4)}` : "Nieznany";
  const normalizedSymbol = signal.token_symbol && signal.token_symbol !== "???" ? signal.token_symbol : "";
  const normalizedName = signal.token_name && signal.token_name !== "???" ? signal.token_name : "";
  const displayToken = normalizedSymbol || normalizedName || fallbackToken;

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg mt-0.5 ${isBuy ? "bg-primary/10" : "bg-destructive/10"}`}>
              {isBuy ? (
                <TrendingUp className="h-5 w-5 text-primary" />
              ) : (
                <TrendingDown className="h-5 w-5 text-destructive" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground text-lg">
                  {signal.signal_type} {displayToken}
                </span>
                <Badge className={statusColors[signal.status] || ""}>
                  {signal.status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Strategia: {signal.strategy}
              </p>
              <p className="text-sm text-foreground/90 mt-1">
                Token: <span className="font-medium">{normalizedName || displayToken}</span>
              </p>
              <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Target className="h-3 w-3" />
                  Score: {signal.smart_score}
                </span>
                <span className="flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3" />
                  Ryzyko: {signal.risk_score}
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  Pewność: {signal.confidence}%
                </span>
                {signal.conditions?.correlation_wallets > 1 && (
                  <span className="flex items-center gap-1 text-primary">
                    <Users className="h-3 w-3" />
                    Konsensus: {signal.conditions.correlation_wallets} portfeli (+{signal.conditions.correlation_bonus}pts)
                  </span>
                )}
                {signal.conditions?.sentiment && signal.conditions.sentiment !== "unknown" && (
                  <span className={`flex items-center gap-1 ${
                    signal.conditions.sentiment === "bullish" ? "text-primary" :
                    signal.conditions.sentiment === "bearish" ? "text-destructive" : "text-muted-foreground"
                  }`}>
                    🧠 {signal.conditions.sentiment} ({signal.conditions.sentiment_score > 0 ? "+" : ""}{signal.conditions.sentiment_score})
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-mono truncate max-w-md">
                {signal.wallet_address}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                📅 {new Date(signal.created_at).toLocaleDateString("pl-PL")} · 🕐 {new Date(signal.created_at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
            </div>
          </div>

          {!readonly && signal.status === "pending" && onAction && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-primary/30 text-primary hover:bg-primary/10"
                onClick={() => onAction(signal.id, "approved")}
              >
                <CheckCircle2 className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={() => onAction(signal.id, "rejected")}
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
