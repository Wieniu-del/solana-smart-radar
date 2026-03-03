import { WalletData } from "@/types/wallet";
import { Flame, Activity, Clock, Hash } from "lucide-react";

interface StatCardsProps {
  data: WalletData;
}

const statusColors: Record<string, string> = {
  "High Activity": "text-neon-red",
  Active: "text-primary",
  Moderate: "text-neon-amber",
  Dormant: "text-muted-foreground",
};

const StatCards = ({ data }: StatCardsProps) => {
  const cards = [
    {
      icon: Flame,
      label: "Smart Score",
      value: data.smartScore.toString(),
      sub: data.status,
      color: statusColors[data.status] || "text-foreground",
    },
    {
      icon: Activity,
      label: "Transakcje 24h",
      value: data.transactionCount24h.toString(),
      sub: "ostatnie 24 godziny",
      color: "text-secondary",
    },
    {
      icon: Clock,
      label: "Ostatnia aktywność",
      value: data.lastActivityAge,
      sub: "czas od ostatniej TX",
      color: "text-neon-cyan",
    },
    {
      icon: Hash,
      label: "Łączne transakcje",
      value: data.totalTransactions.toLocaleString(),
      sub: `${data.recentTransactions.length} pobrane · ${data.recentTransactions.filter(t => t.status === "finalized").length} finalized`,
      color: "text-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, i) => (
        <div
          key={i}
          className="neon-card rounded-xl p-5 flex flex-col gap-2"
          style={{ animation: `fade-in-up 0.4s ease-out ${i * 0.1}s both` }}
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <card.icon className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">{card.label}</span>
          </div>
          <div className={`font-mono text-2xl font-bold ${card.color}`}>{card.value}</div>
          <div className="text-xs text-muted-foreground">{card.sub}</div>
        </div>
      ))}
    </div>
  );
};

export default StatCards;
