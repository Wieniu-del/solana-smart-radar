import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Bot, Zap, ShieldAlert, TrendingUp, TrendingDown, Clock, AlertTriangle,
  CheckCircle2, XCircle, Activity, Target, DollarSign
} from "lucide-react";
import {
  getStrategies, toggleStrategy, getRecentSignals, updateSignalStatus,
  type StrategyConfig
} from "@/services/tradingEngine";

export default function AutoTrading() {
  const [strategies, setStrategies] = useState<StrategyConfig[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

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
            <h1 className="text-2xl font-bold text-foreground">Auto Trading</h1>
            <p className="text-sm text-muted-foreground">Warstwa decyzyjna — strategie i sygnały</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-primary/30 text-primary">
            <Activity className="h-3 w-3 mr-1" />
            {activeStrategies} aktywnych
          </Badge>
          {pendingSignals > 0 && (
            <Badge className="bg-neon-amber/20 text-neon-amber border-neon-amber/30">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {pendingSignals} oczekujących
            </Badge>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={Target} label="Aktywne strategie" value={activeStrategies} color="text-primary" />
        <StatCard icon={Zap} label="Sygnały łącznie" value={signals.length} color="text-secondary" />
        <StatCard icon={TrendingUp} label="Sygnały BUY" value={buySignals} color="text-primary" />
        <StatCard icon={TrendingDown} label="Sygnały SELL" value={sellSignals} color="text-destructive" />
      </div>

      <Tabs defaultValue="strategies" className="space-y-4">
        <TabsList className="bg-muted">
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
        </TabsList>

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
                        <Badge variant="outline" className="text-[10px]">
                          {strategy.signal_type}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{strategy.description}</p>
                      <div className="flex gap-3 mt-2 text-[10px] text-muted-foreground">
                        <span>Max: {strategy.max_position_sol} SOL</span>
                        {strategy.stop_loss_pct && <span>SL: {strategy.stop_loss_pct}%</span>}
                        {strategy.take_profit_pct && <span>TP: {strategy.take_profit_pct}%</span>}
                        {Object.entries(strategy.conditions).map(([k, v]) => (
                          <span key={k}>{k}: {String(v)}</span>
                        ))}
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
                <p className="text-xs mt-1">Przeanalizuj portfel na stronie Analiza, aby wygenerować sygnały</p>
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
      </Tabs>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4 flex items-center gap-3">
        <Icon className={`h-5 w-5 ${color}`} />
        <div>
          <p className="text-2xl font-bold text-foreground">{value}</p>
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
                <span className="font-semibold text-foreground">
                  {signal.signal_type} {signal.token_symbol}
                </span>
                <Badge className={statusColors[signal.status] || ""}>
                  {signal.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Strategia: {signal.strategy}
              </p>
              <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground">
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
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate max-w-xs">
                {signal.wallet_address}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {new Date(signal.created_at).toLocaleString("pl-PL")}
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
