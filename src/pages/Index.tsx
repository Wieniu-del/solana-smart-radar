import { useState } from "react";
import RadarLogo from "@/components/RadarLogo";
import WalletSearch from "@/components/WalletSearch";
import ScoreDisplay from "@/components/ScoreDisplay";
import ActivityChart from "@/components/ActivityChart";
import TransactionList from "@/components/TransactionList";
import { WalletData, mockWalletData } from "@/types/wallet";
import { Radar } from "lucide-react";

const Index = () => {
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (address: string) => {
    setIsLoading(true);
    setError(null);

    try {
      // Try real backend first, fallback to mock
      const response = await fetch(`/api/wallet/${encodeURIComponent(address)}`);
      if (!response.ok) throw new Error("Backend unavailable");
      const data = await response.json();
      setWalletData(data);
    } catch {
      // Use mock data for development
      setWalletData({ ...mockWalletData, address });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background grid */}
      <div
        className="fixed inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-12">
          <RadarLogo />
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <div className="w-2 h-2 rounded-full bg-primary pulse-neon" />
            MAINNET
          </div>
        </header>

        {/* Search */}
        <div className="mb-12">
          <WalletSearch onSearch={handleSearch} isLoading={isLoading} />
        </div>

        {/* Results */}
        {walletData && (
          <div className="space-y-6" style={{ animation: "fade-in-up 0.5s ease-out" }}>
            {/* Address display */}
            <div className="text-center">
              <span className="font-mono text-xs text-muted-foreground bg-muted/50 px-4 py-2 rounded-full border border-border">
                {walletData.address}
              </span>
            </div>

            {/* Main grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1">
                <ScoreDisplay data={walletData} />
              </div>
              <div className="lg:col-span-2 space-y-6">
                <ActivityChart hourlyActivity={walletData.hourlyActivity} />
                <TransactionList transactions={walletData.recentTransactions} />
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!walletData && !isLoading && (
          <div className="text-center py-20">
            <Radar className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground text-sm">
              Enter a Solana wallet address to analyze
            </p>
          </div>
        )}

        {error && (
          <div className="text-center py-8">
            <p className="text-destructive text-sm">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
