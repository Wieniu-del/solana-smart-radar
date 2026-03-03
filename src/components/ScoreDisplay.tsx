import { WalletData } from "@/types/wallet";

interface ScoreDisplayProps {
  data: WalletData;
}

const statusConfig = {
  "High Activity": { color: "text-neon-red", bg: "bg-neon-red/10", border: "border-neon-red/30", icon: "🔥" },
  "Active": { color: "text-neon-green", bg: "bg-neon-green/10", border: "border-neon-green/30", icon: "🟢" },
  "Moderate": { color: "text-neon-amber", bg: "bg-neon-amber/10", border: "border-neon-amber/30", icon: "🟡" },
  "Dormant": { color: "text-muted-foreground", bg: "bg-muted", border: "border-border", icon: "⚫" },
};

const ScoreDisplay = ({ data }: ScoreDisplayProps) => {
  const config = statusConfig[data.status];
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (data.smartScore / 100) * circumference;

  return (
    <div className="neon-card rounded-xl p-8 flex flex-col items-center gap-6">
      {/* Score Ring */}
      <div className="relative w-40 h-40">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="54" fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
          <circle
            cx="60" cy="60" r="54" fill="none"
            stroke="hsl(var(--neon-glow))"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000 ease-out"
            style={{ filter: "drop-shadow(0 0 6px hsl(155 100% 50% / 0.5))" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold font-mono neon-glow">{data.smartScore}</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Score</span>
        </div>
      </div>

      {/* Status Badge */}
      <div className={`px-4 py-1.5 rounded-full border ${config.bg} ${config.border} ${config.color} text-sm font-semibold tracking-wide`}>
        {config.icon} {data.status}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 w-full">
        <MetricBox label="TX 24h" value={data.transactionCount24h.toString()} />
        <MetricBox label="Total TX" value={data.totalTransactions.toLocaleString()} />
        <MetricBox label="Last Active" value={data.lastActivityAge} span />
      </div>
    </div>
  );
};

const MetricBox = ({ label, value, span }: { label: string; value: string; span?: boolean }) => (
  <div className={`bg-muted/50 rounded-lg p-3 text-center ${span ? "col-span-2" : ""}`}>
    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
    <div className="font-mono text-sm font-semibold text-foreground">{value}</div>
  </div>
);

export default ScoreDisplay;
