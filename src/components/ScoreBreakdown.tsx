import { SmartScoreBreakdown } from "@/services/walletScoring";
import { BarChart2, Clock, Coins, TrendingUp, Zap } from "lucide-react";

interface ScoreBreakdownProps {
  breakdown: SmartScoreBreakdown;
}

const categories = [
  { key: "activityScore" as const, label: "Aktywność", max: 25, icon: Zap },
  { key: "consistencyScore" as const, label: "Regularność", max: 20, icon: Clock },
  { key: "diversityScore" as const, label: "Dywersyfikacja", max: 20, icon: Coins },
  { key: "volumeScore" as const, label: "Wolumen", max: 20, icon: TrendingUp },
  { key: "recencyScore" as const, label: "Świeżość", max: 15, icon: BarChart2 },
];

const ScoreBreakdown = ({ breakdown }: ScoreBreakdownProps) => {
  return (
    <div className="neon-card rounded-xl p-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        📊 Rozkład Smart Score
      </h3>
      <div className="space-y-3">
        {categories.map((cat) => {
          const value = breakdown[cat.key];
          const pct = (value / cat.max) * 100;
          const Icon = cat.icon;
          return (
            <div key={cat.key}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{cat.label}</span>
                </div>
                <span className="text-xs font-mono font-bold text-foreground">
                  {value}/{cat.max}
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, opacity: 0.5 + pct / 200 }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 pt-4 border-t border-border">
        <div className="space-y-1">
          {breakdown.details.map((d, i) => (
            <p key={i} className="text-[11px] text-muted-foreground font-mono">• {d}</p>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ScoreBreakdown;
