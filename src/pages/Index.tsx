import { useMemo } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Search, TrendingUp, Activity, Zap, Clock, ArrowUpRight, Brain } from "lucide-react";
import { mockTopWallets, generateMockWallet } from "@/types/wallet";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from "recharts";

const Index = () => {
  const { history } = useSearchHistory();

  // Mock network stats
  const networkStats = useMemo(() => ({
    totalTxToday: 4_283_102,
    activeWallets: 312_847,
    avgSmartScore: 43,
    topBurstWallets: 18,
  }), []);

  // Mock 24h network chart data
  const networkChart = useMemo(() =>
    Array.from({ length: 24 }, (_, i) => ({
      hour: `${i}:00`,
      tx: Math.floor(100000 + Math.random() * 200000),
      wallets: Math.floor(8000 + Math.random() * 15000),
    })), []);

  // Top 5 wallets
  const topWallets = useMemo(() =>
    [...mockTopWallets].sort((a, b) => b.smartScore - a.smartScore).slice(0, 5), []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Centrum dowodzenia Smart Money Radar</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard icon={BarChart3} label="Transakcje (24h)" value={networkStats.totalTxToday.toLocaleString()} change="+12.4%" />
        <KPICard icon={Activity} label="Aktywne portfele" value={networkStats.activeWallets.toLocaleString()} change="+3.1%" />
        <KPICard icon={Brain} label="Śr. Smart Score" value={networkStats.avgSmartScore.toString()} change="+2" />
        <KPICard icon={Zap} label="Burst wallets" value={networkStats.topBurstWallets.toString()} change="↑ 5" accent />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Network Activity Chart */}
        <div className="lg:col-span-2 neon-card rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Aktywność sieci 24h</h3>
            <Link to="/activity" className="text-xs text-primary hover:underline flex items-center gap-1">
              Więcej <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={networkChart}>
              <defs>
                <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(155, 100%, 50%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(155, 100%, 50%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "hsl(220,10%,55%)" }} axisLine={false} tickLine={false} interval={5} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: "hsl(220,18%,10%)", border: "1px solid hsl(220,15%,18%)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "hsl(220,10%,55%)" }}
              />
              <Area type="monotone" dataKey="tx" stroke="hsl(155, 100%, 50%)" fill="url(#txGrad)" strokeWidth={2} name="Transakcje" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Top Smart Wallets */}
        <div className="neon-card rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Top Smart Wallets</h3>
            <Link to="/ranking" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ranking <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-3">
            {topWallets.map((w, i) => (
              <div key={w.address} className="flex items-center gap-3 group">
                <span className="text-xs font-mono text-muted-foreground w-5">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <Link to="/analyze" className="text-xs font-mono text-foreground hover:text-primary truncate block">
                    {w.address.slice(0, 4)}...{w.address.slice(-4)}
                  </Link>
                </div>
                <ScoreBadge score={w.smartScore} />
                <span className="text-xs text-muted-foreground font-mono">{w.transactionCount24h} tx</span>
              </div>
            ))}
          </div>
        </div>
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
              {history.slice(0, 5).map((entry) => (
                <div key={entry.address} className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2">
                  <span className="text-xs font-mono text-foreground truncate flex-1">
                    {entry.address.slice(0, 6)}...{entry.address.slice(-4)}
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
            <QuickAction to="/analyze" icon={Search} label="Analiza portfela" desc="Wklej adres Solana" />
            <QuickAction to="/ranking" icon={TrendingUp} label="Ranking" desc="Top smart wallets" />
            <QuickAction to="/activity" icon={Activity} label="Aktywność 24h" desc="Mapa godzinowa" />
            <QuickAction to="/alerts" icon={Zap} label="Alerty" desc="Ustaw powiadomienia" />
          </div>
        </div>
      </div>
    </div>
  );
};

function KPICard({ icon: Icon, label, value, change, accent }: {
  icon: React.ElementType; label: string; value: string; change: string; accent?: boolean;
}) {
  return (
    <div className="neon-card rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${accent ? "text-neon-amber" : "text-primary"}`} />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-end justify-between">
        <span className="text-xl font-bold font-mono text-foreground">{value}</span>
        <span className={`text-xs font-mono ${accent ? "text-neon-amber" : "text-primary"}`}>{change}</span>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score > 70 ? "text-neon-red bg-neon-red/10" : score > 40 ? "text-primary bg-primary/10" : score > 20 ? "text-neon-amber bg-neon-amber/10" : "text-muted-foreground bg-muted";
  return <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${color}`}>{score}</span>;
}

function QuickAction({ to, icon: Icon, label, desc }: {
  to: string; icon: React.ElementType; label: string; desc: string;
}) {
  return (
    <Link to={to} className="bg-muted/30 hover:bg-muted/60 rounded-lg p-3 transition-colors group">
      <Icon className="h-5 w-5 text-primary mb-1.5 group-hover:scale-110 transition-transform" />
      <div className="text-xs font-semibold text-foreground">{label}</div>
      <div className="text-[10px] text-muted-foreground">{desc}</div>
    </Link>
  );
}

export default Index;
