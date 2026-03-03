import { useState } from "react";
import WalletSearch from "@/components/WalletSearch";
import StatCards from "@/components/StatCards";
import ScoreDisplay from "@/components/ScoreDisplay";
import ActivityChart from "@/components/ActivityChart";
import TransactionList from "@/components/TransactionList";
import PatternAnalysis from "@/components/PatternAnalysis";
import { WalletData, mockWalletData } from "@/types/wallet";
import { Search } from "lucide-react";

const Analyze = () => {
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
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold mb-1">Analiza Portfela</h1>
        <p className="text-sm text-muted-foreground">Wklej adres Solana i uzyskaj pełną analizę aktywności</p>
      </div>

      <WalletSearch onSearch={handleSearch} isLoading={isLoading} />

      {walletData && (
        <div className="space-y-6" style={{ animation: "fade-in-up 0.5s ease-out" }}>
          {/* Address */}
          <div className="text-center">
            <span className="font-mono text-xs text-muted-foreground bg-muted/50 px-4 py-2 rounded-full border border-border">
              {walletData.address}
            </span>
          </div>

          {/* 4 Stat Cards */}
          <StatCards data={walletData} />

          {/* Main grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <ScoreDisplay data={walletData} />
            </div>
            <div className="lg:col-span-2 space-y-6">
              <ActivityChart hourlyActivity={walletData.hourlyActivity} />
              <PatternAnalysis data={walletData} />
              <TransactionList transactions={walletData.recentTransactions} />
            </div>
          </div>
        </div>
      )}

      {!walletData && !isLoading && (
        <div className="text-center py-20">
          <Search className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground text-sm">
            Wklej adres portfela Solana, aby rozpocząć analizę
          </p>
        </div>
      )}
    </div>
  );
};

export default Analyze;
