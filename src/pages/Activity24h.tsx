import { useMemo } from "react";
import { Activity, TrendingUp, Clock, Zap } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell,
  AreaChart, Area,
} from "recharts";

const Activity24h = () => {
  // Mock hourly global activity
  const hourlyData = useMemo(() =>
    Array.from({ length: 24 }, (_, i) => {
      const tx = Math.floor(80000 + Math.random() * 250000);
      const wallets = Math.floor(5000 + Math.random() * 20000);
      return { hour: `${String(i).padStart(2, "0")}:00`, tx, wallets, smart: Math.floor(wallets * 0.02 + Math.random() * 200) };
    }), []);

  const totalTx = hourlyData.reduce((s, d) => s + d.tx, 0);
  const peakHour = hourlyData.reduce((max, d) => d.tx > max.tx ? d : max, hourlyData[0]);
  const avgTx = Math.round(totalTx / 24);
  const totalSmart = hourlyData.reduce((s, d) => s + d.smart, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold mb-1">Aktywność 24h</h1>
        <p className="text-sm text-muted-foreground">Globalna mapa aktywności on-chain z ostatnich 24 godzin</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Activity} label="Łączne TX" value={totalTx.toLocaleString()} />
        <StatCard icon={TrendingUp} label="Średnia / godz." value={avgTx.toLocaleString()} />
        <StatCard icon={Clock} label="Peak hour" value={peakHour.hour} />
        <StatCard icon={Zap} label="Smart wallets" value={totalSmart.toLocaleString()} />
      </div>

      {/* Main Bar Chart */}
      <div className="neon-card rounded-xl p-6">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Transakcje na godzinę</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={hourlyData}>
            <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "hsl(220,10%,55%)" }} axisLine={false} tickLine={false} interval={2} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(220,10%,55%)" }} axisLine={false} tickLine={false} width={50} />
            <Tooltip
              contentStyle={{ background: "hsl(220,18%,10%)", border: "1px solid hsl(220,15%,18%)", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "hsl(220,10%,55%)" }}
            />
            <Bar dataKey="tx" name="Transakcje" radius={[4, 4, 0, 0]}>
              {hourlyData.map((entry, i) => {
                const isMax = entry.hour === peakHour.hour;
                return <Cell key={i} fill={isMax ? "hsl(38, 100%, 55%)" : "hsl(155, 100%, 50%)"} fillOpacity={isMax ? 1 : 0.6} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Secondary Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Wallets */}
        <div className="neon-card rounded-xl p-6">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Aktywne portfele / godz.</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={hourlyData}>
              <defs>
                <linearGradient id="walletGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(185, 100%, 50%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(185, 100%, 50%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "hsl(220,10%,55%)" }} axisLine={false} tickLine={false} interval={5} />
              <YAxis hide />
              <Tooltip contentStyle={{ background: "hsl(220,18%,10%)", border: "1px solid hsl(220,15%,18%)", borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="wallets" stroke="hsl(185, 100%, 50%)" fill="url(#walletGrad)" strokeWidth={2} name="Portfele" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Smart Wallets detected */}
        <div className="neon-card rounded-xl p-6">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Wykryte smart wallets / godz.</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={hourlyData}>
              <defs>
                <linearGradient id="smartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(38, 100%, 55%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(38, 100%, 55%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "hsl(220,10%,55%)" }} axisLine={false} tickLine={false} interval={5} />
              <YAxis hide />
              <Tooltip contentStyle={{ background: "hsl(220,18%,10%)", border: "1px solid hsl(220,15%,18%)", borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="smart" stroke="hsl(38, 100%, 55%)" fill="url(#smartGrad)" strokeWidth={2} name="Smart wallets" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Heatmap */}
      <div className="neon-card rounded-xl p-6">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Heatmapa aktywności</h3>
        <div className="grid grid-cols-24 gap-1">
          {hourlyData.map((d, i) => {
            const max = Math.max(...hourlyData.map(h => h.tx));
            const intensity = d.tx / max;
            return (
              <div key={i} className="flex flex-col items-center gap-1">
                <div
                  className="w-full aspect-square rounded-sm transition-all hover:scale-110"
                  style={{
                    backgroundColor: `hsl(155, 100%, 50%)`,
                    opacity: 0.1 + intensity * 0.9,
                  }}
                  title={`${d.hour}: ${d.tx.toLocaleString()} TX`}
                />
                {i % 4 === 0 && <span className="text-[8px] text-muted-foreground font-mono">{i}h</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="neon-card rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className="text-lg font-bold font-mono text-foreground">{value}</span>
    </div>
  );
}

export default Activity24h;
