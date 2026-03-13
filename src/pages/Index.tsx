import { useMemo, useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3, Search, TrendingUp, Activity, Zap, Clock, ArrowUpRight,
  Brain, Trophy, DollarSign, Target, PieChart, Layers, Timer, Radio, Cpu, Gauge, Coins
} from "lucide-react";
import { mockTopWallets } from "@/types/wallet";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { supabase } from "@/integrations/supabase/client";
import { useSolanaLiveStats } from "@/hooks/useSolanaLiveStats";
import LivePulse from "@/components/LivePulse";
import BotHealthMonitor from "@/components/BotHealthMonitor";
import PortfolioHealth from "@/components/PortfolioHealth";
import AnimatedCounter from "@/components/AnimatedCounter";
import PositionDetailModal from "@/components/PositionDetailModal";
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
  const [botHero, setBotHero] = useState({
    walletBalance: 0,
    portfolioValue: 0,
    totalPnlPct: 0,
    activePositions: 0,
    botActive: false,
  });
  const [openPositions, setOpenPositions] = useState<any[]>([]);
  const [closedPositions, setClosedPositions] = useState<any[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<any>(null);
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [positionsTab, setPositionsTab] = useState<"open" | "closed">("open");

  // Auto-switch to closed tab when no open positions exist
  useEffect(() => {
    if (openPositions.length === 0 && closedPositions.length > 0) {
      setPositionsTab("closed");
    } else if (openPositions.length > 0) {
      setPositionsTab("open");
    }
  }, [openPositions.length, closedPositions.length]);

  // Live clock tick for animated effects
  useEffect(() => {
    const timer = setInterval(() => setClockTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadTradingStats();
    loadBotHero();
    const interval = setInterval(() => { loadTradingStats(); loadBotHero(); }, 10_000);
    return () => clearInterval(interval);
  }, []);

  const loadTradingStats = async () => {
    try {
      const [closedRes, sigRes, execRes] = await Promise.all([
        supabase.from("open_positions").select("*").eq("status", "closed").order("closed_at", { ascending: false }),
        supabase.from("trading_signals").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("trade_executions").select("*").order("created_at", { ascending: false }).limit(10),
      ]);

      const closed = (closedRes.data || []).filter((p: any) => p.close_reason !== "dead_token");
      const signals = sigRes.data || [];
      const executions = execRes.data || [];

      const wins = closed.filter((p: any) => (p.pnl_pct || 0) > 0);
      const totalPnl = closed.reduce((sum: number, p: any) => sum + ((p.pnl_pct || 0) / 100) * p.amount_sol, 0);
      const best = wins.sort((a: any, b: any) => (b.pnl_pct || 0) - (a.pnl_pct || 0))[0] || null;

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
        totalTrades: closed.length,
        successfulTrades: wins.length,
        totalPnlSol: totalPnl,
        winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
        bestTrade: best,
        recentExecutions: executions.slice(0, 5),
        signalsByDay: Array.from(dayMap, ([day, count]) => ({ day, count })),
      });
    } catch (e) {
      console.warn("Failed to load trading stats:", e);
    }
  };

  const loadBotHero = async () => {
    try {
      const [posRes, closedRes, configRes, healthRes] = await Promise.all([
        supabase.from("open_positions").select("*").eq("status", "open"),
        supabase.from("open_positions").select("*").eq("status", "closed").order("closed_at", { ascending: false }).limit(10),
        supabase.from("bot_config").select("value").eq("key", "bot_enabled").single(),
        supabase.functions.invoke("bot-health"),
      ]);
      const openPos = posRes.data || [];
      const closedPos = closedRes.data || [];
      setOpenPositions(openPos);
      setClosedPositions(closedPos.slice(0, 10));

      const portfolioValue = openPos.reduce((s: number, p: any) => s + p.amount_sol, 0);
      const totalInvested = [...openPos, ...closedPos].reduce((s: number, p: any) => s + p.amount_sol, 0);
      const totalPnlSol = closedPos.reduce((s: number, p: any) => s + ((p.pnl_pct || 0) / 100) * p.amount_sol, 0)
        + openPos.reduce((s: number, p: any) => s + ((p.pnl_pct || 0) / 100) * p.amount_sol, 0);
      const totalPnlPct = totalInvested > 0 ? (totalPnlSol / totalInvested) * 100 : 0;

      const botEnabled = configRes.data?.value === true || configRes.data?.value === "true";
      
      // Auto-select tab based on data
      if (openPos.length === 0 && closedPos.length > 0) {
        setPositionsTab("closed");
      } else if (openPos.length > 0) {
        setPositionsTab("open");
      }
      
      // Real wallet balance from RPC
      const healthData = healthRes.data;
      const realBalance = healthData?.infrastructure?.wallet_balance_sol;

      setBotHero({
        walletBalance: realBalance ?? (portfolioValue + totalPnlSol),
        portfolioValue,
        totalPnlPct,
        activePositions: openPositions.length,
        botActive: botEnabled,
      });
    } catch (e) {
      console.warn("Failed to load bot hero:", e);
    }
  };

  // Top 5 wallets
  const topWallets = useMemo(() =>
    [...mockTopWallets].sort((a, b) => b.smartScore - a.smartScore).slice(0, 5), []);




  return (
    <div className="space-y-6">
      {/* ═══ HERO BANNER — Wieniu Bot 2026 ═══ */}
      <div className="neon-card rounded-xl p-6 md:p-8 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, hsl(var(--card)) 0%, hsl(220, 20%, 8%) 50%, hsl(155, 30%, 8%) 100%)" }}>
        {/* Animated glow */}
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-10 blur-3xl pointer-events-none"
          style={{ background: "hsl(155, 100%, 50%)", animation: "pulse 3s ease-in-out infinite" }} />

        <div className="flex items-start justify-between mb-4 relative">
          <div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight"
              style={{ color: "hsl(200, 100%, 70%)", animation: "balance-pulse 3s ease-in-out infinite",
                textShadow: "0 0 20px hsl(200, 100%, 60%, 0.5), 0 0 40px hsl(200, 100%, 60%, 0.2)" }}>WIENIU BOT 2026</h1>
            <p className="text-xs font-mono text-muted-foreground mt-1">Solana Trading Terminal v3.0.1</p>
          </div>
          <div className="flex items-center gap-2">
            <Radio className={`h-4 w-4 ${botHero.botActive ? "text-primary animate-pulse" : "text-muted-foreground"}`} />
            <span className={`text-xs font-black uppercase px-3 py-1 rounded border ${
              botHero.botActive
                ? "text-primary border-primary bg-primary/10 shadow-[0_0_12px_hsl(155,100%,50%,0.3)]"
                : "text-muted-foreground border-border bg-muted/30"
            }`}>
              {botHero.botActive ? "ONLINE" : "OFFLINE"}
            </span>
          </div>
        </div>

        <div className="mb-6 relative">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1">Wallet Balance</p>
          <p className="text-5xl md:text-7xl font-black font-mono text-primary"
            style={{
              animation: "balance-pulse 3s ease-in-out infinite",
              textShadow: "0 0 30px hsl(155, 100%, 50%, 0.4), 0 0 60px hsl(155, 100%, 50%, 0.15)",
            }}>
            {botHero.walletBalance.toFixed(2)} <span className="text-4xl md:text-5xl">SOL</span>
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 relative">
          <HeroStat icon={TrendingUp} label="Portfolio Value" value={`${botHero.portfolioValue.toFixed(1)} SOL`} />
          <HeroStat icon={Activity} label="Total PnL"
            value={`${botHero.totalPnlPct >= 0 ? "+" : ""}${botHero.totalPnlPct.toFixed(1)}%`}
            valueColor={botHero.totalPnlPct >= 0 ? "text-primary" : "text-destructive"} />
          <HeroStat icon={Zap} label="Active Positions" value={String(botHero.activePositions)} />
          <HeroStat icon={Radio} label="Status"
            value={botHero.botActive ? "ACTIVE" : "INACTIVE"}
            valueColor={botHero.botActive ? "text-primary" : "text-muted-foreground"}
            glow={botHero.botActive} />
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

      {/* Bot Health Monitor */}
      <BotHealthMonitor />

      {/* Portfolio Health Widget */}
      <PortfolioHealth />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Hodlowane Tokeny */}
        <div className="lg:col-span-2 neon-card rounded-xl p-6 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none scan-line opacity-30" />
          
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Moje pozycje</h3>
              <LivePulse color="bg-primary" />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex bg-muted/30 rounded-lg p-0.5 border border-border">
                <button
                  onClick={() => setPositionsTab("open")}
                  className={`text-[10px] font-bold px-3 py-1 rounded-md transition-all ${positionsTab === "open" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Otwarte ({openPositions.length})
                </button>
                <button
                  onClick={() => setPositionsTab("closed")}
                  className={`text-[10px] font-bold px-3 py-1 rounded-md transition-all ${positionsTab === "closed" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Zamknięte ({closedPositions.length})
                </button>
              </div>
              <Link to="/trading" className="text-xs text-primary hover:underline flex items-center gap-1">
                Auto Trading <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </div>

          {(() => {
            const positions = positionsTab === "open" ? openPositions : closedPositions;
            if (positions.length === 0) {
              return (
                <div className="text-center py-10">
                  <Coins className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">
                    {positionsTab === "open" ? "Brak otwartych pozycji — bot czeka na sygnał" : "Brak zamkniętych pozycji"}
                  </p>
                </div>
              );
            }
            return (
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                <div className="grid grid-cols-[1fr_80px_80px_70px_60px] gap-2 px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wider font-mono">
                  <span>Token</span>
                  <span className="text-right">Kupno</span>
                  <span className="text-right">{positionsTab === "open" ? "Teraz" : "Wyjście"}</span>
                  <span className="text-right">PnL</span>
                  <span className="text-right">SOL</span>
                </div>
                {positions.map((pos: any, i: number) => {
                  const pnl = pos.pnl_pct || 0;
                  const isUp = pnl >= 0;
                  const currentPrice = pos.current_price_usd || 0;
                  const entryPrice = pos.entry_price_usd || 0;
                  const reasonLabel = pos.close_reason
                    ? { stop_loss: "🔴", trailing_stop: "🟡", take_profit: "🟢", dead_token: "💀", profit_fade: "🟠", fast_loss_cut: "⚡", time_decay: "⏰", manual_sell: "🖐️" }[pos.close_reason] || ""
                    : "";
                  return (
                    <div
                      key={pos.id}
                      onClick={() => { setSelectedPosition(pos); setShowPositionModal(true); }}
                      className="grid grid-cols-[1fr_80px_80px_70px_60px] gap-2 items-center bg-muted/20 hover:bg-muted/40 rounded-lg px-3 py-2.5 transition-all duration-300 cursor-pointer group"
                      style={{ animation: `fade-in-up 0.3s ease-out ${i * 0.06}s both` }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isUp ? "bg-primary" : "bg-destructive"}`} />
                        <span className="text-sm font-bold text-foreground truncate group-hover:text-primary transition-colors">
                          {reasonLabel} {pos.token_symbol || pos.token_mint?.slice(0, 6)}
                        </span>
                      </div>
                      <span className="text-xs font-mono text-muted-foreground text-right">
                        ${entryPrice < 0.01 ? entryPrice.toExponential(1) : entryPrice.toFixed(4)}
                      </span>
                      <span className={`text-xs font-mono text-right font-semibold ${isUp ? "text-primary" : "text-destructive"}`}>
                        ${currentPrice < 0.01 ? currentPrice.toExponential(1) : currentPrice.toFixed(4)}
                      </span>
                      <span className={`text-xs font-mono font-black text-right ${isUp ? "text-primary" : "text-destructive"}`}>
                        {isUp ? "+" : ""}{pnl.toFixed(1)}%
                      </span>
                      <span className="text-xs font-mono text-muted-foreground text-right">
                        {pos.amount_sol?.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        <PositionDetailModal
          position={selectedPosition}
          open={showPositionModal}
          onOpenChange={setShowPositionModal}
        />

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

function HeroStat({ icon: Icon, label, value, valueColor = "text-foreground", glow }: {
  icon: React.ElementType; label: string; value: string; valueColor?: string; glow?: boolean;
}) {
  return (
    <div className={`bg-muted/20 border border-border rounded-lg p-3 hover:bg-muted/40 transition-all duration-300 ${glow ? "shadow-[0_0_12px_hsl(155,100%,50%,0.2)] border-primary/40" : ""}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">{label}</span>
      </div>
      <p className={`text-lg md:text-xl font-black font-mono ${valueColor}`}>{value}</p>
    </div>
  );
}

export default Index;
