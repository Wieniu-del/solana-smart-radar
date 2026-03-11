import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Shield, TrendingUp, TrendingDown, AlertTriangle, HeartPulse,
  Skull, Flame, Snowflake, CheckCircle2
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, Tooltip
} from "recharts";
import LivePulse from "./LivePulse";

interface PortfolioHealthData {
  walletBalance: number;
  openPositions: any[];
  closedPositions: any[];
  dailyPnl: { date: string; pnl: number; cumulative: number }[];
  healthScore: number;
  healthLabel: string;
  healthColor: string;
  winRate: number;
  totalPnlSol: number;
  avgHoldTime: number;
  riskLevel: string;
  protections: { label: string; active: boolean; icon: any }[];
  closedByReason: { name: string; value: number; color: string }[];
}

const PortfolioHealth = () => {
  const [data, setData] = useState<PortfolioHealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30_000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [openRes, closedRes, healthRes, configRes] = await Promise.all([
        supabase.from("open_positions").select("*").eq("status", "open"),
        supabase.from("open_positions").select("*").eq("status", "closed").order("closed_at", { ascending: false }).limit(100),
        supabase.functions.invoke("bot-health"),
        supabase.from("bot_config").select("key, value").in("key", ["sell_only_mode", "min_balance_sol", "stop_loss_pct"]),
      ]);

      const open = openRes.data || [];
      const closed = closedRes.data || [];
      const healthData = healthRes.data;
      const configs = configRes.data || [];

      const getConfig = (key: string) => configs.find((c: any) => c.key === key)?.value;
      const sellOnly = getConfig("sell_only_mode") === true || getConfig("sell_only_mode") === "true";
      const minBalance = Number(getConfig("min_balance_sol")) || 0.5;
      const stopLoss = Number(getConfig("stop_loss_pct")) || 15;
      const walletBalance = healthData?.infrastructure?.wallet_balance_sol || 0;

      // Win rate
      const realClosed = closed.filter((p: any) => p.close_reason !== "dead_token");
      const wins = realClosed.filter((p: any) => (p.pnl_pct || 0) > 0);
      const winRate = realClosed.length > 0 ? (wins.length / realClosed.length) * 100 : 0;
      const totalPnlSol = realClosed.reduce((s: number, p: any) => s + ((p.pnl_pct || 0) / 100) * p.amount_sol, 0);

      // Avg hold time (hours)
      const holdTimes = realClosed
        .filter((p: any) => p.opened_at && p.closed_at)
        .map((p: any) => (new Date(p.closed_at).getTime() - new Date(p.opened_at).getTime()) / 3600000);
      const avgHoldTime = holdTimes.length > 0 ? holdTimes.reduce((s, t) => s + t, 0) / holdTimes.length : 0;

      // Daily PnL (last 14 days)
      const dailyMap = new Map<string, number>();
      for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dailyMap.set(d.toISOString().split("T")[0], 0);
      }
      for (const p of realClosed) {
        if (!p.closed_at) continue;
        const day = p.closed_at.split("T")[0];
        if (dailyMap.has(day)) {
          dailyMap.set(day, (dailyMap.get(day) || 0) + ((p.pnl_pct || 0) / 100) * p.amount_sol);
        }
      }
      let cum = 0;
      const dailyPnl = Array.from(dailyMap, ([date, pnl]) => {
        cum += pnl;
        return { date: date.slice(5), pnl: Math.round(pnl * 10000) / 10000, cumulative: Math.round(cum * 10000) / 10000 };
      });

      // Closed by reason
      const reasonCounts = new Map<string, number>();
      for (const p of closed) {
        const r = p.close_reason || "unknown";
        reasonCounts.set(r, (reasonCounts.get(r) || 0) + 1);
      }
      const reasonColors: Record<string, string> = {
        stop_loss: "hsl(0, 80%, 55%)",
        trailing_stop: "hsl(45, 90%, 55%)",
        fast_loss_cut: "hsl(15, 85%, 55%)",
        profit_fade: "hsl(30, 80%, 55%)",
        time_decay: "hsl(200, 70%, 55%)",
        dead_token: "hsl(0, 0%, 45%)",
        manual_sell: "hsl(155, 80%, 50%)",
        take_profit: "hsl(120, 70%, 50%)",
      };
      const closedByReason = Array.from(reasonCounts, ([name, value]) => ({
        name: reasonLabels[name] || name,
        value,
        color: reasonColors[name] || "hsl(220, 15%, 50%)",
      }));

      // Health score (0-100)
      let healthScore = 50;
      if (winRate > 50) healthScore += 15;
      else if (winRate > 30) healthScore += 5;
      else healthScore -= 10;
      if (totalPnlSol > 0) healthScore += 20;
      else if (totalPnlSol > -0.05) healthScore += 5;
      else healthScore -= 15;
      if (walletBalance > 1) healthScore += 10;
      else if (walletBalance > 0.5) healthScore += 5;
      else healthScore -= 10;
      if (open.length <= 3) healthScore += 5;
      healthScore = Math.max(0, Math.min(100, healthScore));

      const healthLabel = healthScore >= 80 ? "Doskonały" : healthScore >= 60 ? "Dobry" : healthScore >= 40 ? "Średni" : healthScore >= 20 ? "Słaby" : "Krytyczny";
      const healthColor = healthScore >= 80 ? "hsl(155, 100%, 50%)" : healthScore >= 60 ? "hsl(120, 70%, 50%)" : healthScore >= 40 ? "hsl(45, 90%, 55%)" : healthScore >= 20 ? "hsl(30, 80%, 55%)" : "hsl(0, 80%, 55%)";

      // Risk level
      const unrealizedPnl = open.reduce((s: number, p: any) => s + ((p.pnl_pct || 0) / 100) * p.amount_sol, 0);
      const riskLevel = open.length >= 3 ? "Wysoki" : open.length >= 2 ? "Średni" : open.length >= 1 ? "Niski" : "Brak";

      // Protections
      const protections = [
        { label: `Stop Loss -${stopLoss}%`, active: true, icon: Shield },
        { label: "Trailing Stop", active: true, icon: TrendingUp },
        { label: "Balance Guard (0.5 SOL)", active: walletBalance < minBalance, icon: AlertTriangle },
        { label: "Sell-Only Mode", active: sellOnly, icon: Snowflake },
        { label: "Cooldown (2 straty)", active: true, icon: Flame },
        { label: "Daily Loss Limit (0.1 SOL)", active: true, icon: Skull },
      ];

      setData({
        walletBalance,
        openPositions: open,
        closedPositions: realClosed,
        dailyPnl,
        healthScore,
        healthLabel,
        healthColor,
        winRate,
        totalPnlSol,
        avgHoldTime,
        riskLevel,
        protections,
        closedByReason,
      });
    } catch (e) {
      console.warn("Portfolio health load error:", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="neon-card rounded-xl p-6 animate-pulse">
        <div className="h-6 w-48 bg-muted/50 rounded mb-4" />
        <div className="grid grid-cols-3 gap-4">
          <div className="h-32 bg-muted/30 rounded-lg" />
          <div className="h-32 bg-muted/30 rounded-lg" />
          <div className="h-32 bg-muted/30 rounded-lg" />
        </div>
      </div>
    );
  }

  const gaugeAngle = (data.healthScore / 100) * 180;

  return (
    <div className="neon-card rounded-xl p-6 relative overflow-hidden">
      {/* Background glow */}
      <div
        className="absolute top-0 left-0 w-48 h-48 rounded-full opacity-10 blur-3xl pointer-events-none"
        style={{ background: data.healthColor }}
      />

      <div className="flex items-center gap-2 mb-5">
        <HeartPulse className="h-5 w-5 animate-pulse" style={{ color: data.healthColor }} />
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Zdrowie Portfela
        </h3>
        <LivePulse color="bg-primary" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Health Gauge */}
        <div className="flex flex-col items-center justify-center">
          <div className="relative w-40 h-24 mb-3">
            <svg viewBox="0 0 200 110" className="w-full h-full">
              {/* Background arc */}
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke="hsl(220, 15%, 15%)"
                strokeWidth="14"
                strokeLinecap="round"
              />
              {/* Health arc */}
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke={data.healthColor}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={`${(gaugeAngle / 180) * 251.2} 251.2`}
                style={{ filter: `drop-shadow(0 0 8px ${data.healthColor}60)` }}
              />
              {/* Score text */}
              <text x="100" y="85" textAnchor="middle" fill={data.healthColor} fontSize="32" fontWeight="900" fontFamily="monospace">
                {data.healthScore}
              </text>
              <text x="100" y="105" textAnchor="middle" fill="hsl(220, 10%, 55%)" fontSize="12">
                {data.healthLabel}
              </text>
            </svg>
          </div>

          <div className="grid grid-cols-2 gap-3 w-full">
            <MiniStat label="Win Rate" value={`${data.winRate.toFixed(0)}%`} color={data.winRate >= 50 ? "text-primary" : "text-destructive"} />
            <MiniStat label="P&L" value={`${data.totalPnlSol >= 0 ? "+" : ""}${data.totalPnlSol.toFixed(4)}`} color={data.totalPnlSol >= 0 ? "text-primary" : "text-destructive"} />
            <MiniStat label="Avg Hold" value={`${data.avgHoldTime.toFixed(1)}h`} color="text-secondary" />
            <MiniStat label="Ryzyko" value={data.riskLevel} color={data.riskLevel === "Wysoki" ? "text-destructive" : data.riskLevel === "Średni" ? "text-neon-amber" : "text-primary"} />
          </div>
        </div>

        {/* PnL Chart (14 days) */}
        <div className="lg:col-span-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">P&L (14 dni)</p>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={data.dailyPnl}>
              <defs>
                <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={data.totalPnlSol >= 0 ? "hsl(155, 100%, 50%)" : "hsl(0, 80%, 55%)"} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={data.totalPnlSol >= 0 ? "hsl(155, 100%, 50%)" : "hsl(0, 80%, 55%)"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(220,10%,55%)" }} axisLine={false} tickLine={false} interval={2} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: "hsl(220,18%,10%)", border: "1px solid hsl(220,15%,18%)", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number) => [`${v.toFixed(4)} SOL`, "P&L"]}
              />
              <Area
                type="monotone"
                dataKey="cumulative"
                stroke={data.totalPnlSol >= 0 ? "hsl(155, 100%, 50%)" : "hsl(0, 80%, 55%)"}
                fill="url(#pnlGrad)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>

          {/* Close reasons pie */}
          {data.closedByReason.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Powody zamknięcia</p>
              <div className="flex items-center gap-3">
                <ResponsiveContainer width={80} height={80}>
                  <PieChart>
                    <Pie
                      data={data.closedByReason}
                      cx="50%"
                      cy="50%"
                      innerRadius={22}
                      outerRadius={35}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {data.closedByReason.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-1">
                  {data.closedByReason.slice(0, 4).map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: r.color }} />
                      <span className="text-[10px] text-muted-foreground">{r.name} ({r.value})</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Protections */}
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Ochrona kapitału</p>
          <div className="space-y-2">
            {data.protections.map((p, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                  p.active
                    ? "bg-primary/5 border-primary/20"
                    : "bg-muted/10 border-border"
                }`}
              >
                <p.icon className={`h-3.5 w-3.5 ${p.active ? "text-primary" : "text-muted-foreground"}`} />
                <span className={`text-xs ${p.active ? "text-foreground" : "text-muted-foreground"}`}>{p.label}</span>
                <span className="ml-auto">
                  {p.active ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* Open positions summary */}
          {data.openPositions.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Otwarte pozycje ({data.openPositions.length})</p>
              {data.openPositions.map((p: any) => (
                <div key={p.id} className="flex items-center gap-2 py-1">
                  {(p.pnl_pct || 0) >= 0 ? (
                    <TrendingUp className="h-3 w-3 text-primary" />
                  ) : (
                    <TrendingDown className="h-3 w-3 text-destructive" />
                  )}
                  <span className="text-xs font-mono text-foreground flex-1">{p.token_symbol || "???"}</span>
                  <span className={`text-xs font-bold font-mono ${(p.pnl_pct || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                    {(p.pnl_pct || 0) >= 0 ? "+" : ""}{(p.pnl_pct || 0).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const reasonLabels: Record<string, string> = {
  stop_loss: "Stop Loss",
  trailing_stop: "Trailing Stop",
  fast_loss_cut: "Fast Cut",
  profit_fade: "Profit Fade",
  time_decay: "Time Decay",
  dead_token: "Dead Token",
  manual_sell: "Manual",
  take_profit: "Take Profit",
};

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-muted/20 border border-border rounded-lg p-2 text-center">
      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
      <p className="text-[9px] text-muted-foreground uppercase">{label}</p>
    </div>
  );
}

export default PortfolioHealth;
