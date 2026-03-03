import { useState } from "react";
import WalletSearch from "@/components/WalletSearch";
import StatCards from "@/components/StatCards";
import ActivityChart from "@/components/ActivityChart";
import PatternAnalysis from "@/components/PatternAnalysis";
import { WalletData, mockWalletData } from "@/types/wallet";
import { BarChart3, Search, Trophy, Bell, Zap } from "lucide-react";
import { Link } from "react-router-dom";

const Index = () => {
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSearch = async (address: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/wallet/${encodeURIComponent(address)}`);
      if (!response.ok) throw new Error("Backend unavailable");
      const data = await response.json();
      setWalletData(data);
    } catch {
      setWalletData({ ...mockWalletData, address });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Centrum dowodzenia Smart Money Radar</p>
      </div>

      {/* Quick Search */}
      <div className="max-w-2xl">
        <WalletSearch onSearch={handleSearch} isLoading={isLoading} />
      </div>

      {/* Quick results */}
      {walletData && (
        <div className="space-y-6" style={{ animation: "fade-in-up 0.5s ease-out" }}>
          <StatCards data={walletData} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ActivityChart hourlyActivity={walletData.hourlyActivity} />
            <PatternAnalysis data={walletData} />
          </div>
          <div className="text-center">
            <Link
              to="/analyze"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline font-medium"
            >
              <Search className="h-4 w-4" />
              Pełna analiza portfela →
            </Link>
          </div>
        </div>
      )}

      {/* Phase roadmap cards */}
      {!walletData && !isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
          {[
            { icon: BarChart3, title: "Faza 1 ✔", desc: "Analiza portfela, Scoring, API", active: true },
            { icon: Trophy, title: "Faza 2", desc: "Ranking, Alerty, Wykresy", active: false },
            { icon: Bell, title: "Faza 3", desc: "Sygnały, Copy Trading", active: false },
            { icon: Zap, title: "Faza 4", desc: "Auto Buy/Sell, Risk Engine", active: false },
          ].map((phase, i) => (
            <div
              key={i}
              className={`neon-card rounded-xl p-5 ${phase.active ? "border-primary/30" : "opacity-60"}`}
            >
              <phase.icon className={`h-8 w-8 mb-3 ${phase.active ? "text-primary" : "text-muted-foreground"}`} />
              <h3 className="font-bold text-sm mb-1">{phase.title}</h3>
              <p className="text-xs text-muted-foreground">{phase.desc}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Index;
