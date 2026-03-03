import { useState } from "react";
import WalletSearch from "@/components/WalletSearch";
import StatCards from "@/components/StatCards";
import ScoreDisplay from "@/components/ScoreDisplay";
import ActivityChart from "@/components/ActivityChart";
import TransactionList from "@/components/TransactionList";
import PatternAnalysis from "@/components/PatternAnalysis";
import { WalletData, mockWalletData } from "@/types/wallet";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { Search, Clock, X } from "lucide-react";

const Analyze = () => {
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { history, addEntry, removeEntry, clearHistory } = useSearchHistory();

  const handleSearch = async (address: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/wallet/${encodeURIComponent(address)}`);
      if (!response.ok) throw new Error("Backend unavailable");
      const data = await response.json();
      setWalletData(data);
      addEntry({ address: data.address, smartScore: data.smartScore, status: data.status });
    } catch {
      const data = { ...mockWalletData, address };
      setWalletData(data);
      addEntry({ address: data.address, smartScore: data.smartScore, status: data.status });
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
          <div className="text-center">
            <span className="font-mono text-xs text-muted-foreground bg-muted/50 px-4 py-2 rounded-full border border-border">
              {walletData.address}
            </span>
          </div>
          <StatCards data={walletData} />
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
        <div className="space-y-6">
          <div className="text-center py-12">
            <Search className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground text-sm">
              Wklej adres portfela Solana, aby rozpocząć analizę
            </p>
          </div>

          {/* Search history */}
          {history.length > 0 && (
            <div className="neon-card rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Historia wyszukiwań
                </h3>
                <button onClick={clearHistory} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
                  Wyczyść
                </button>
              </div>
              <div className="space-y-2">
                {history.slice(0, 8).map((entry) => (
                  <div key={entry.address} className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2 group">
                    <button onClick={() => handleSearch(entry.address)} className="flex-1 text-left">
                      <span className="text-xs font-mono text-foreground hover:text-primary transition-colors">
                        {entry.address.slice(0, 10)}...{entry.address.slice(-6)}
                      </span>
                    </button>
                    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                      entry.smartScore > 70 ? "text-neon-red bg-neon-red/10" :
                      entry.smartScore > 40 ? "text-primary bg-primary/10" :
                      entry.smartScore > 20 ? "text-neon-amber bg-neon-amber/10" :
                      "text-muted-foreground bg-muted"
                    }`}>{entry.smartScore}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleDateString("pl-PL")}
                    </span>
                    <button onClick={() => removeEntry(entry.address)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Analyze;
