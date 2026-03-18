import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  TrendingUp, TrendingDown, BarChart3, Target, Award, Activity, AlertTriangle, Wallet,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from "recharts";

interface Position {
  id: string;
  token_symbol: string | null;
  entry_price_usd: number;
  current_price_usd: number;
  amount_sol: number;
  pnl_pct: number | null;
  opened_at: string;
  closed_at: string | null;
  close_reason: string | null;
  status: string;
  highest_price_usd: number;
  stop_price_usd: number | null;
  trailing_stop_pct: number;
}

// Realistic PnL calculation — cap gains to avoid fantasy numbers
// On micro-cap memes, slippage eats most theoretical gains
function realPnlSol(pnlPct: number, amountSol: number): number {
  if (pnlPct <= 0) {
    return (pnlPct / 100) * amountSol;
  }
  const theoreticalPnl = (pnlPct / 100) * amountSol;
  const maxRealisticGain = amountSol * 5; // max 5x return (500%)
  return Math.min(theoreticalPnl, maxRealisticGain);
}

export default function PnLDashboard() {
  const [closedPositions, setClosedPositions] = useState<Position[]>([]);
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    setLoading(true);
    const [{ data: closed }, { data: open }, healthRes] = await Promise.all([
      supabase
        .from("open_positions")
        .select("*")
        .eq("status", "closed")
        .order("closed_at", { ascending: true }),
      supabase
        .from("open_positions")
        .select("*")
        .eq("status", "open")
        .order("opened_at", { ascending: false }),
      supabase.functions.invoke("bot-health"),
    ]);
    if (closed) setClosedPositions(closed as Position[]);
    if (open) setOpenPositions(open as Position[]);
    if (healthRes.data?.infrastructure?.wallet_balance_sol != null) {
      setWalletBalance(healthRes.data.infrastructure.wallet_balance_sol);
    }
    setLoading(false);
  }

  const positions = closedPositions;
  const totalTrades = positions.length;
  const wins = positions.filter((p) => (p.pnl_pct || 0) > 0);
  const losses = positions.filter((p) => (p.pnl_pct || 0) <= 0);
  const winRate = totalTrades > 0 ? ((wins.length / totalTrades) * 100).toFixed(1) : "0";
  const avgWin = wins.length > 0 ? wins.reduce((s, p) => s + (p.pnl_pct || 0), 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, p) => s + (p.pnl_pct || 0), 0) / losses.length) : 0;
  const profitFactor = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : "∞";

  // Realistic PnL in SOL (capped gains, real losses)
  const totalPnLSol = positions.reduce((s, p) => {
    return s + realPnlSol(p.pnl_pct || 0, p.amount_sol);
  }, 0);

  const totalInvested = positions.reduce((s, p) => s + p.amount_sol, 0);

  const unrealizedPnLSol = openPositions.reduce((s, p) => {
    return s + realPnlSol(p.pnl_pct || 0, p.amount_sol);
  }, 0);

  const bestTrade = positions.length > 0 ? positions.reduce((best, p) => (p.pnl_pct || 0) > (best?.pnl_pct || -Infinity) ? p : best, positions[0]) : null;
  const worstTrade = positions.length > 0 ? positions.reduce((worst, p) => (p.pnl_pct || 0) < (worst?.pnl_pct || Infinity) ? p : worst, positions[0]) : null;

  let cumPnL = 0;
  const chartData = positions.map((p, i) => {
    const pnlSol = realPnlSol(p.pnl_pct || 0, p.amount_sol);
    cumPnL += pnlSol;
    const date = p.closed_at ? new Date(p.closed_at) : new Date(p.opened_at);
    return {
      trade: i + 1,
      date: date.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" }),
      pnl: Number(cumPnL.toFixed(4)),
      tradePnl: Number(pnlSol.toFixed(4)),
      pnlPct: p.pnl_pct || 0,
    };
  });

  const reasonCounts: Record<string, number> = {};
  positions.forEach((p) => {
    const r = p.close_reason || "unknown";
    reasonCounts[r] = (reasonCounts[r] || 0) + 1;
  });
  const reasonData = Object.entries(reasonCounts).map(([name, value]) => ({
    name: name === "trailing_stop" ? "Trailing" : name === "take_profit" ? "TP" : name === "stop_loss" ? "SL" : name === "fast_loss_cut" ? "Fast Cut" : name === "profit_fade" ? "Fade" : name === "time_decay" ? "Decay" : name === "dead_token" ? "Dead" : name === "no_tokens" ? "No Tokens" : name === "max_hold_time" ? "Max Hold" : name,
    value,
  }));

  if (loading) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-8 text-center text-muted-foreground">
          <Activity className="h-8 w-8 mx-auto mb-2 animate-spin text-primary" />
          <p className="text-sm">Ładowanie statystyk...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Wallet Balance — source of truth */}
      {walletBalance != null && (
        <Card className="border-primary/30 bg-card">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Saldo portfela (prawda):</span>
            </div>
            <span className="text-lg font-bold text-foreground">{walletBalance.toFixed(4)} SOL</span>
          </CardContent>
        </Card>
      )}

      {/* Open Positions (Live) */}
      {openPositions.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary animate-pulse" />
              Otwarte pozycje ({openPositions.length}/3)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {openPositions.map((pos) => {
                const pnl = pos.pnl_pct || 0;
                const pnlSol = realPnlSol(pnl, pos.amount_sol);
                const isPositive = pnl >= 0;
                const hoursHeld = ((Date.now() - new Date(pos.opened_at).getTime()) / 3600000).toFixed(1);
                return (
                  <div key={pos.id} className="flex items-center justify-between p-2 rounded-md bg-muted/30 border border-border">
                    <div className="flex items-center gap-3">
                      <Badge variant={isPositive ? "default" : "destructive"} className="text-xs font-mono">
                        {isPositive ? "+" : ""}{pnl.toFixed(1)}%
                      </Badge>
                      <div>
                        <p className="text-sm font-medium">{pos.token_symbol || "???"}</p>
                        <p className="text-[10px] text-muted-foreground">{hoursHeld}h | {pos.amount_sol} SOL</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-mono ${isPositive ? "text-primary" : "text-destructive"}`}>
                        {isPositive ? "+" : ""}{pnlSol.toFixed(4)} SOL
                      </p>
                      <p className="text-[9px] text-muted-foreground">
                        Stop: ${Number(pos.stop_price_usd || 0).toFixed(8)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div className="flex justify-between pt-1 border-t border-border text-xs">
                <span className="text-muted-foreground">Unrealized PnL:</span>
                <span className={unrealizedPnLSol >= 0 ? "text-primary font-bold" : "text-destructive font-bold"}>
                  {unrealizedPnLSol >= 0 ? "+" : ""}{unrealizedPnLSol.toFixed(4)} SOL
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          icon={Target}
          label="Win Rate"
          value={`${winRate}%`}
          sub={`${wins.length}W / ${losses.length}L`}
          positive={Number(winRate) >= 50}
        />
        <MetricCard
          icon={totalPnLSol >= 0 ? TrendingUp : TrendingDown}
          label="Realized PnL (est.)"
          value={`${totalPnLSol >= 0 ? "+" : ""}${totalPnLSol.toFixed(4)} SOL`}
          sub={`${totalTrades} zamkniętych | zainw. ${totalInvested.toFixed(2)} SOL`}
          positive={totalPnLSol >= 0}
        />
        <MetricCard
          icon={Award}
          label="Profit Factor"
          value={profitFactor}
          sub={`Win: +${avgWin.toFixed(1)}% | Loss: -${avgLoss.toFixed(1)}%`}
          positive={Number(profitFactor) >= 1}
        />
        <MetricCard
          icon={BarChart3}
          label="Best / Worst"
          value={`+${(bestTrade?.pnl_pct || 0).toFixed(1)}%`}
          sub={`${bestTrade?.token_symbol || "—"} | ${(worstTrade?.pnl_pct || 0).toFixed(1)}% ${worstTrade?.token_symbol || ""}`}
          positive
        />
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-2 text-[10px] text-muted-foreground bg-muted/20 rounded-md px-3 py-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-neon-amber" />
        <span>
          PnL jest szacunkowy (zyski ograniczone do max 5x per trade z powodu slippage).
          Saldo portfela powyżej to jedyne wiarygodne źródło prawdy.
        </span>
      </div>

      {totalTrades === 0 && openPositions.length === 0 && (
        <Card className="border-border bg-card">
          <CardContent className="p-8 text-center text-muted-foreground">
            <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Brak pozycji</p>
            <p className="text-xs mt-1">Statystyki pojawią się po pierwszym trade</p>
          </CardContent>
        </Card>
      )}

      {totalTrades > 0 && (
        <>
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Kumulatywny PnL (SOL) — szacunkowy
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                    <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        borderColor: "hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number) => [`${v.toFixed(4)} SOL`, "PnL"]}
                    />
                    <defs>
                      <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="pnl"
                      stroke="hsl(var(--primary))"
                      fill="url(#pnlGrad)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">PnL per trade (%)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="trade" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        formatter={(v: number) => [`${v.toFixed(1)}%`, "PnL"]}
                      />
                      <Bar
                        dataKey="pnlPct"
                        fill="hsl(var(--primary))"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Dystrybucja zamknięć</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reasonData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={70} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="value" fill="hsl(var(--secondary))" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub, positive }: {
  icon: any; label: string; value: string; sub: string; positive: boolean;
}) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={`h-4 w-4 ${positive ? "text-primary" : "text-destructive"}`} />
          <span className="text-[10px] text-muted-foreground">{label}</span>
        </div>
        <p className={`text-lg font-bold ${positive ? "text-primary" : "text-destructive"}`}>{value}</p>
        <p className="text-[9px] text-muted-foreground truncate">{sub}</p>
      </CardContent>
    </Card>
  );
}