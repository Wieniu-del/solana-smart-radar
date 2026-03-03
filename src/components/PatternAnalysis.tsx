import { WalletData } from "@/types/wallet";
import { TrendingUp, Zap, Clock, BarChart2 } from "lucide-react";

interface PatternAnalysisProps {
  data: WalletData;
}

const PatternAnalysis = ({ data }: PatternAnalysisProps) => {
  const activity = data.hourlyActivity;
  const avg = activity.reduce((a, b) => a + b, 0) / activity.length;
  const max = Math.max(...activity);
  const burstThreshold = avg * 3;
  const burstHours = activity.filter((v) => v >= burstThreshold).length;
  
  // Variability (coefficient of variation)
  const variance = activity.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / activity.length;
  const stdDev = Math.sqrt(variance);
  const cv = avg > 0 ? ((stdDev / avg) * 100).toFixed(0) : "0";

  // Regularity: how many hours have activity > 0
  const activeHours = activity.filter((v) => v > 0).length;
  const regularity = ((activeHours / 24) * 100).toFixed(0);

  const patterns = [
    {
      icon: BarChart2,
      label: "Śr. TX / godz.",
      value: avg.toFixed(1),
      sub: `Max: ${max}`,
    },
    {
      icon: Zap,
      label: "Burst Detection",
      value: `${burstHours} godz.`,
      sub: burstHours > 0 ? "⚡ Wykryto burst" : "Brak burstu",
      highlight: burstHours > 0,
    },
    {
      icon: TrendingUp,
      label: "Zmienność",
      value: `${cv}%`,
      sub: Number(cv) > 100 ? "Wysoka" : Number(cv) > 50 ? "Średnia" : "Niska",
    },
    {
      icon: Clock,
      label: "Regularność",
      value: `${regularity}%`,
      sub: `${activeHours}/24 godz. aktywnych`,
    },
  ];

  return (
    <div className="neon-card rounded-xl p-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        🔍 Analiza Wzorców
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {patterns.map((p, i) => (
          <div
            key={i}
            className={`bg-muted/50 rounded-lg p-4 border ${
              p.highlight ? "border-neon-amber/40" : "border-transparent"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <p.icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
                {p.label}
              </span>
            </div>
            <div className="font-mono text-lg font-bold text-foreground">{p.value}</div>
            <div className={`text-xs mt-1 ${p.highlight ? "text-neon-amber" : "text-muted-foreground"}`}>
              {p.sub}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PatternAnalysis;
