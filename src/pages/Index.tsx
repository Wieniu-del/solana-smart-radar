import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  TrendingUp, Activity, Zap, ArrowUpRight, Radio, Coins, DollarSign
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import LivePulse from "@/components/LivePulse";
import BotHealthMonitor from "@/components/BotHealthMonitor";
import PortfolioHealth from "@/components/PortfolioHealth";
import FeeDrainTracker from "@/components/FeeDrainTracker";
import PositionDetailModal from "@/components/PositionDetailModal";

const PNL_CAP = 50; // cap zysku per pozycja
const capPnl = (p: number) => Math.max(Math.min(p, PNL_CAP), -100);

const Index = () => {
  const [botHero, setBotHero] = useState({
    walletBalance: 0,
    portfolioValue: 0,
    totalPnlSol: 0,
    activePositions: 0,
    botActive: false,
    winRate: 0,
    totalTrades: 0,
  });
  const [openPositions, setOpenPositions] = useState<any[]>([]);
  const [closedPositions, setClosedPositions] = useState<any[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<any>(null);
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [positionsTab, setPositionsTab] = useState<"open" | "closed">("open");

  useEffect(() => {
    if (openPositions.length === 0 && closedPositions.length > 0) {
      setPositionsTab("closed");
    } else if (openPositions.length > 0) {
      setPositionsTab("open");
    }
  }, [openPositions.length, closedPositions.length]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15_000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [posRes, closedRes, configRes, healthRes] = await Promise.all([
        supabase.from("open_positions").select("*").eq("status", "open"),
        supabase.from("open_positions").select("*").eq("status", "closed").order("closed_at", { ascending: false }).limit(20),
        supabase.from("bot_config").select("value").eq("key", "bot_enabled").single(),
        supabase.functions.invoke("bot-health"),
      ]);
      const openPos = posRes.data || [];
      const closedPos = closedRes.data || [];
      setOpenPositions(openPos);
      setClosedPositions(closedPos);

      const wins = closedPos.filter((p: any) => capPnl(p.pnl_pct || 0) > 0);
      const totalPnlSol = closedPos.reduce((s: number, p: any) =>
        s + (capPnl(p.pnl_pct || 0) / 100) * p.amount_sol, 0);

      const botEnabled = configRes.data?.value === true || configRes.data?.value === "true";
      const healthData = healthRes.data;
      const realBalance = healthData?.infrastructure?.wallet_balance_sol;

      setBotHero({
        walletBalance: realBalance ?? 0,
        portfolioValue: openPos.reduce((s: number, p: any) => s + p.amount_sol, 0),
        totalPnlSol,
        activePositions: openPos.length,
        botActive: botEnabled,
        winRate: closedPos.length > 0 ? (wins.length / closedPos.length) * 100 : 0,
        totalTrades: closedPos.length,
      });
    } catch (e) {
      console.warn("Failed to load dashboard:", e);
    }
  };

  return (
    <div className="space-y-6">
      {/* ═══ HERO BANNER ═══ */}
      <div className="neon-card rounded-xl p-6 md:p-8 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, hsl(var(--card)) 0%, hsl(220, 20%, 8%) 50%, hsl(155, 30%, 8%) 100%)" }}>
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-10 blur-3xl pointer-events-none"
          style={{ background: "hsl(155, 100%, 50%)", animation: "pulse 3s ease-in-out infinite" }} />

        <div className="flex items-start justify-between mb-4 relative">
          <div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight"
              style={{ color: "hsl(200, 100%, 70%)",
                textShadow: "0 0 20px hsl(200, 100%, 60%, 0.5), 0 0 40px hsl(200, 100%, 60%, 0.2)" }}>
              WIENIU BOT 2026
            </h1>
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
          <HeroStat icon={Coins} label="Aktywne pozycje" value={String(botHero.activePositions)} />
          <HeroStat icon={DollarSign} label="PnL (cap 50%)"
            value={`${botHero.totalPnlSol >= 0 ? "+" : ""}${botHero.totalPnlSol.toFixed(3)} SOL`}
            valueColor={botHero.totalPnlSol >= 0 ? "text-primary" : "text-destructive"} />
          <HeroStat icon={Activity} label="Win Rate"
            value={`${botHero.winRate.toFixed(0)}%`}
            valueColor={botHero.winRate >= 50 ? "text-primary" : "text-destructive"} />
          <HeroStat icon={TrendingUp} label="Zamknięte"
            value={`${botHero.totalTrades} trades`} />
        </div>
      </div>

      {/* Bot Health + Portfolio Health + Fee Drain */}
      <BotHealthMonitor />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PortfolioHealth />
        </div>
        <FeeDrainTracker />
      </div>

      {/* ═══ POZYCJE ═══ */}
      <div className="neon-card rounded-xl p-6 relative overflow-hidden">
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
              Terminal <ArrowUpRight className="h-3 w-3" />
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
                const pnl = capPnl(pos.pnl_pct || 0);
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
    </div>
  );
};

function HeroStat({ icon: Icon, label, value, valueColor = "text-foreground" }: {
  icon: React.ElementType; label: string; value: string; valueColor?: string;
}) {
  return (
    <div className="bg-muted/20 border border-border rounded-lg p-3 hover:bg-muted/40 transition-all duration-300">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">{label}</span>
      </div>
      <p className={`text-lg md:text-xl font-black font-mono ${valueColor}`}>{value}</p>
    </div>
  );
}

export default Index;
