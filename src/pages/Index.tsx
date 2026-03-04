import { useMemo, useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3, Search, TrendingUp, Activity, Zap, Clock, ArrowUpRight,
  Brain, Trophy, DollarSign, Target, PieChart, Layers, Timer, Radio, Cpu, Gauge
} from "lucide-react";
import { mockTopWallets } from "@/types/wallet";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { supabase } from "@/integrations/supabase/client";
import { useSolanaLiveStats } from "@/hooks/useSolanaLiveStats";
import LivePulse from "@/components/LivePulse";
import AnimatedCounter from "@/components/AnimatedCounter";
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, BarChart, Bar
} from "recharts";

const Index = () => {
  const { history } = useSearchHistory();
  const { stats, loading: statsLoading } = useSolanaLiveStats();

  const [tradingStats, setTradingStats] = useState({
    totalTrades: 0,
    successfulTrades: 0,
    totalPnlSol: 0,
    winRate: 0,
    bestTrade: null as any,
    recentExecutions: [] as any[],
    signalsByDay: [] as { day: string; count: number }[],
  });

  const [clockTick, setClockTick] = useState(0);

  // Live clock tick for animated effects
  useEffect(() => {
    const timer = setInterval(() => setClockTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadTradingStats();
    // Auto-refresh trading stats every 30s
    const interval = setInterval(loadTradingStats, 30_000);
    return () => clearInterval(interval);
  }, []);

  const loadTradingStats = async () => {
    try {
      const [execRes, sigRes] = await Promise.all([
        supabase.from("trade_executions").select("*").order("created_at", { ascending: false }).limit(100),
        supabase.from("trading_signals").select("*").order("created_at", { ascending: false }).limit(200),
      ]);

      const executions = execRes.data || [];
      const signals = sigRes.data || [];

      const successful = executions.filter(e => e.status === "success");
      const totalPnl = executions.reduce((sum, e) => {
        if (e.action === "SELL" && e.status === "success") return sum + e.amount_sol;
        if (e.action === "BUY" && e.status === "success") return sum - e.amount_sol;
        return sum;
      }, 0);

      const best = successful.sort((a, b) => b.amount_sol - a.amount_sol)[0] || null;

      const dayMap = new Map<string, number>();
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dayMap.set(d.toLocaleDateString("pl-PL", { weekday: "short" }), 0);
      }
      for (const sig of signals) {
        const d = new Date(sig.created_at);
        const key = d.toLocaleDateString("pl-PL", { weekday: "short" });
        if (dayMap.has(key)) dayMap.set(key, (dayMap.get(key) || 0) + 1);
      }

      setTradingStats({
        totalTrades: executions.length,
        successfulTrades: successful.length,
        totalPnlSol: totalPnl,
        winRate: executions.length > 0 ? (successful.length / executions.length) * 100 : 0,
        bestTrade: best,
        recentExecutions: executions.slice(0, 5),
        signalsByDay: Array.from(dayMap, ([day, count]) => ({ day, count })),
      });
    } catch (e) {
      console.warn("Failed to load trading stats:", e);
    }
  };

  // Top 5 wallets
  const topWallets = useMemo(() =>
    [...mockTopWallets].sort((a, b) => b.smartScore - a.smartScore).slice(0, 5), []);

  // Simulated live network chart that updates
  const [networkChart, setNetworkChart] = useState(() =>
    Array.from({ length: 24 }, (_, i) => ({
      hour: `${i}:00`,
      tx: Math.floor(100000 + Math.random() * 200000),
      wallets: Math.floor(8000 + Math.random() * 15000),
    }))
  );

  // Update current hour bar live
  useEffect(() => {
    if (!stats) return;
    const currentHour = new Date().getHours();
    setNetworkChart(prev => prev.map((d, i) =>
      i === currentHour
        ? { ...d, tx: d.tx + Math.floor(Math.random() * 3000 - 1000) }
        : d
    ));
  }, [clockTick, stats]);

  return (
    <div className="space-y-6">
      {/* Header with live indicator */}
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Centrum dowodzenia Smart Money Radar</p>
        </div>
        <div className="ml-auto flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-full px-3 py-1.5">
          <LivePulse />
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary">LIVE</span>
        </div>
      </div>

      {/* KPI Cards — Real-time Solana stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <LiveKPICard
          icon={Layers}
          label="Block Height"
          value={stats?.blockHeight || 0}
          color="text-primary"
          glowColor="hsl(155, 100%, 50%)"
          loading={statsLoading}
          tick={clockTick}
        />
        <LiveKPICard
          icon={Gauge}
          label="TPS (real-time)"
          value={stats?.tps || 0}
          color="text-secondary"
          glowColor="hsl(185, 100%, 50%)"
          loading={statsLoading}
          tick={clockTick}
          suffix=" tx/s"
        />
        <LiveKPICard
          icon={Timer}
          label="Slot Time"
          value={stats?.slotTime || 0}
          color="text-neon-amber"
          glowColor="hsl(38, 100%, 55%)"
          loading={statsLoading}
          tick={clockTick}
          suffix=" ms"
        />
        <LiveKPICard
          icon={Radio}
          label={`Epoch ${stats?.epoch || "—"}`}
          value={stats?.epochProgress || 0}
          color="text-purple-400"
          glowColor="hsl(270, 80%, 65%)"
          loading={statsLoading}
          tick={clockTick}
          suffix="%"
          isProgress
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Network Activity Chart */}
        <div className="lg:col-span-2 neon-card rounded-xl p-6 relative overflow-hidden">
          {/* Animated scan line */}
          <div className="absolute inset-0 pointer-events-none scan-line opacity-30" />
          
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Aktywność sieci 24h</h3>
              <LivePulse color="bg-primary" />
            </div>
            <Link to="/activity" className="text-xs text-primary hover:underline flex items-center gap-1">
              Więcej <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={networkChart}>
              <defs>
                <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(155, 100%, 50%)" stopOpacity={0.4} />
                  <stop offset="50%" stopColor="hsl(185, 100%, 50%)" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="hsl(155, 100%, 50%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="strokeGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="hsl(155, 100%, 50%)" />
                  <stop offset="50%" stopColor="hsl(185, 100%, 50%)" />
                  <stop offset="100%" stopColor="hsl(270, 80%, 65%)" />
                </linearGradient>
              </defs>
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "hsl(220,10%,55%)" }} axisLine={false} tickLine={false} interval={5} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: "hsl(220,18%,10%)", border: "1px solid hsl(220,15%,18%)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "hsl(220,10%,55%)" }}
              />
              <Area type="monotone" dataKey="tx" stroke="url(#strokeGrad)" fill="url(#txGrad)" strokeWidth={2.5} name="Transakcje" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Top Smart Wallets */}
        <div className="neon-card rounded-xl p-6 flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Top Smart Wallets</h3>
            <Link to="/ranking" className="text-xs text-neon-red hover:underline flex items-center gap-1 font-medium">
              Ranking <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-1 flex-1">
            {topWallets.map((w, i) => (
              <Link
                to={`/analyze?address=${encodeURIComponent(w.address)}`}
                key={w.address}
                className="flex items-center gap-3 group hover:bg-muted/30 rounded-lg px-3 py-3 transition-all duration-300"
                style={{ animation: `fade-in-up 0.4s ease-out ${i * 0.08}s both` }}
              >
                <span className="text-xs font-mono text-muted-foreground w-6 shrink-0">#{i + 1}</span>
                <span className="text-xs font-mono text-foreground group-hover:text-primary transition-colors truncate flex-1">
                  {w.address.slice(0, 4)}...{w.address.slice(-4)}
                </span>
                <ScoreBadge score={w.smartScore} />
                <span className="text-[11px] text-muted-foreground font-mono shrink-0">{w.transactionCount24h} tx</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ MOJE WYNIKI ═══ */}
      <div className="neon-card rounded-xl p-6 relative overflow-hidden">
        {/* Subtle animated gradient overlay */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            background: `linear-gradient(${clockTick * 2}deg, hsl(155,100%,50%), hsl(38,100%,55%), hsl(270,80%,65%))`,
            transition: "background 1s linear",
          }}
        />

        <div className="flex items-center justify-between mb-5 relative">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-neon-amber animate-pulse" />
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Moje wyniki tradingowe</h3>
          </div>
          <Link to="/trading" className="text-xs text-primary hover:underline flex items-center gap-1">
            Auto Trading <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 relative">
          <ResultCard icon={Target} color="text-primary" borderColor="border-primary/20" value={tradingStats.totalTrades} label="Transakcji" />
          <ResultCard icon={Activity} color="text-secondary" borderColor="border-secondary/20" value={`${tradingStats.winRate.toFixed(1)}%`} label="Win Rate" />
          <ResultCard
            icon={DollarSign}
            color={tradingStats.totalPnlSol >= 0 ? "text-primary" : "text-destructive"}
            borderColor={tradingStats.totalPnlSol >= 0 ? "border-primary/20" : "border-destructive/20"}
            value={`${tradingStats.totalPnlSol >= 0 ? "+" : ""}${tradingStats.totalPnlSol.toFixed(3)} SOL`}
            label="P&L"
          />
          <ResultCard icon={PieChart} color="text-purple-400" borderColor="border-purple-400/20" value={tradingStats.successfulTrades} label="Udane" />
        </div>

        {/* Signals chart */}
        {tradingStats.signalsByDay.length > 0 && (
          <div className="mb-4 relative">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Sygnały (ostatnie 7 dni)</p>
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={tradingStats.signalsByDay}>
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(155, 100%, 50%)" />
                    <stop offset="100%" stopColor="hsl(185, 100%, 50%)" />
                  </linearGradient>
                </defs>
                <Bar dataKey="count" fill="url(#barGrad)" radius={[4, 4, 0, 0]} />
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: "hsl(220,10%,55%)" }} axisLine={false} tickLine={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Recent executions */}
        {tradingStats.recentExecutions.length > 0 ? (
          <div className="space-y-2 relative">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Ostatnie transakcje</p>
            {tradingStats.recentExecutions.map((ex, i) => (
              <div
                key={ex.id}
                className="flex items-center gap-3 bg-muted/20 hover:bg-muted/40 rounded-lg px-3 py-2 transition-all duration-300"
                style={{ animation: `fade-in-up 0.3s ease-out ${i * 0.05}s both` }}
              >
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ex.action === "BUY" ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"}`}>
                  {ex.action}
                </span>
                <span className="text-xs font-mono text-foreground flex-1 truncate">
                  {ex.token_symbol || ex.token_mint?.slice(0, 8)}
                </span>
                <span className="text-xs font-mono text-muted-foreground">{ex.amount_sol} SOL</span>
                <span className={`text-[10px] ${ex.status === "success" ? "text-primary" : "text-destructive"}`}>
                  {ex.status === "success" ? "✓" : "✗"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 relative">
            <p className="text-xs text-muted-foreground">Brak transakcji — uruchom bota w <Link to="/trading" className="text-primary hover:underline">Auto Trading</Link></p>
          </div>
        )}
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Searches */}
        <div className="neon-card rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Ostatnie wyszukiwania</h3>
            <Link to="/analyze" className="text-xs text-primary hover:underline flex items-center gap-1">
              <Search className="h-3 w-3" /> Analizuj
            </Link>
          </div>
          {history.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Brak historii wyszukiwań</p>
              <Link to="/analyze" className="text-xs text-primary hover:underline mt-2 inline-block">
                Rozpocznij pierwszą analizę →
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {history.slice(0, 5).map((entry, i) => (
                <div
                  key={entry.address}
                  className="flex items-center gap-3 bg-muted/30 hover:bg-muted/50 rounded-lg px-3 py-2 transition-all duration-300"
                  style={{ animation: `fade-in-up 0.3s ease-out ${i * 0.06}s both` }}
                >
                  <span className="text-xs font-mono text-foreground break-all flex-1">
                    {entry.address}
                  </span>
                  <ScoreBadge score={entry.smartScore} />
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleDateString("pl-PL")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="neon-card rounded-xl p-6">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Szybkie akcje</h3>
          <div className="grid grid-cols-2 gap-3">
            <QuickAction to="/analyze" icon={Search} label="Analiza portfela" desc="Wklej adres Solana" color="text-primary" />
            <QuickAction to="/ranking" icon={TrendingUp} label="Ranking" desc="Top smart wallets" color="text-secondary" />
            <QuickAction to="/activity" icon={Activity} label="Aktywność 24h" desc="Mapa godzinowa" color="text-neon-amber" />
            <QuickAction to="/alerts" icon={Zap} label="Alerty" desc="Ustaw powiadomienia" color="text-purple-400" />
          </div>
        </div>
      </div>
    </div>
  );
};

/* ═══ Sub-components ═══ */

function LiveKPICard({ icon: Icon, label, value, color, glowColor, loading, tick, suffix = "", isProgress }: {
  icon: React.ElementType; label: string; value: number; color: string;
  glowColor: string; loading: boolean; tick: number; suffix?: string; isProgress?: boolean;
}) {
  return (
    <div
      className="neon-card rounded-xl p-4 relative overflow-hidden group hover:scale-[1.02] transition-transform duration-300"
      style={{ boxShadow: `0 0 ${12 + Math.sin(tick * 0.5) * 6}px ${glowColor}15` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
        <LivePulse color={color.replace("text-", "bg-")} />
      </div>
      {loading ? (
        <div className="h-6 w-24 bg-muted/50 rounded animate-pulse" />
      ) : (
        <div className="flex items-end gap-1">
          <AnimatedCounter
            value={value}
            className={`text-xl font-bold font-mono ${color}`}
            format={n => isProgress ? n.toFixed(1) : n.toLocaleString()}
          />
          {suffix && <span className={`text-xs font-mono ${color} opacity-70 mb-0.5`}>{suffix}</span>}
        </div>
      )}
      {isProgress && !loading && (
        <div className="mt-2 h-1.5 bg-muted/50 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${value}%`,
              background: `linear-gradient(90deg, ${glowColor}, ${glowColor}88)`,
            }}
          />
        </div>
      )}
    </div>
  );
}

function ResultCard({ icon: Icon, color, borderColor, value, label }: {
  icon: React.ElementType; color: string; borderColor: string; value: string | number; label: string;
}) {
  return (
    <div className={`bg-muted/20 border ${borderColor} rounded-lg p-3 text-center hover:bg-muted/40 transition-all duration-300`}>
      <Icon className={`h-4 w-4 ${color} mx-auto mb-1`} />
      <p className={`text-lg font-bold font-mono ${color}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score > 70 ? "text-neon-red bg-neon-red/10 border-neon-red/20" :
    score > 40 ? "text-primary bg-primary/10 border-primary/20" :
    score > 20 ? "text-neon-amber bg-neon-amber/10 border-neon-amber/20" :
    "text-muted-foreground bg-muted border-border";
  return <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${color}`}>{score}</span>;
}

function QuickAction({ to, icon: Icon, label, desc, color = "text-primary" }: {
  to: string; icon: React.ElementType; label: string; desc: string; color?: string;
}) {
  return (
    <Link to={to} className="bg-muted/30 hover:bg-muted/60 rounded-lg p-3 transition-all duration-300 group hover:scale-[1.03]">
      <Icon className={`h-5 w-5 ${color} mb-1.5 group-hover:scale-110 transition-transform`} />
      <div className="text-xs font-semibold text-foreground">{label}</div>
      <div className="text-[10px] text-muted-foreground">{desc}</div>
    </Link>
  );
}

export default Index;
