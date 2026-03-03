import { useState } from "react";
import WalletSearch from "@/components/WalletSearch";
import StatCards from "@/components/StatCards";
import ScoreDisplay from "@/components/ScoreDisplay";
import ActivityChart from "@/components/ActivityChart";
import TransactionList from "@/components/TransactionList";
import PatternAnalysis from "@/components/PatternAnalysis";
import TokenHoldings from "@/components/TokenHoldings";
import TradeHistory from "@/components/TradeHistory";
import ScoreBreakdown from "@/components/ScoreBreakdown";
import { WalletData, mockWalletData } from "@/types/wallet";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { analyzeWallet, WalletAnalysis, getHeliusApiKey, HeliusTokenBalance, ParsedTrade } from "@/services/helius";
import { calculateSmartScore, getScoreStatus, SmartScoreBreakdown } from "@/services/walletScoring";
import { analyzeAllTokens } from "@/services/tokenSecurity";
import { generateSignals, getStrategies, saveSignals } from "@/services/tradingEngine";
import BlockchainStatus from "@/components/BlockchainStatus";
import TokenSecurityAnalysis from "@/components/TokenSecurityAnalysis";
import { Search, Clock, X, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";

const Analyze = () => {
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [tokens, setTokens] = useState<HeliusTokenBalance[]>([]);
  const [trades, setTrades] = useState<ParsedTrade[]>([]);
  const [scoreBreakdown, setScoreBreakdown] = useState<SmartScoreBreakdown | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const { history, addEntry, removeEntry, clearHistory } = useSearchHistory();

  const handleSearch = async (address: string) => {
    setIsLoading(true);
    setIsLive(false);

    const hasApiKey = !!getHeliusApiKey();

    if (hasApiKey) {
      try {
        const analysis: WalletAnalysis = await analyzeWallet(address);
        const breakdown = calculateSmartScore(analysis);
        const status = getScoreStatus(breakdown.total);

        const data: WalletData = {
          address: analysis.address,
          smartScore: breakdown.total,
          status,
          transactionCount24h: analysis.tx24h,
          totalTransactions: analysis.txCount,
          lastActivityAge: analysis.lastActivity
            ? formatTimeAgo(analysis.lastActivity)
            : "Brak danych",
          hourlyActivity: analysis.hourlyActivity,
          recentTransactions: analysis.transactions.slice(0, 10).map((tx) => ({
            signature: tx.signature.slice(0, 4) + "..." + tx.signature.slice(-4),
            blockTime: tx.timestamp,
            status: "finalized",
            fee: tx.fee,
          })),
        };

        setWalletData(data);
        setTokens(analysis.tokens);
        setTrades(analysis.trades);
        setScoreBreakdown(breakdown);
        setIsLive(true);
        addEntry({ address: data.address, smartScore: data.smartScore, status: data.status });
        toast.success("Dane pobrane z Solana blockchain!");

        // Generate trading signals
        try {
          const strategies = await getStrategies();
          const secReports = analyzeAllTokens(analysis.tokens);
          const signals = generateSignals(analysis, strategies, secReports);
          if (signals.length > 0) {
            await saveSignals(signals);
            toast.info(`🤖 Wygenerowano ${signals.length} sygnałów tradingowych — sprawdź Auto Trading`);
          }
        } catch (sigErr) {
          console.warn("Signal generation error:", sigErr);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Nieznany błąd";
        toast.error(`Błąd Helius API: ${msg}`);
        // Fallback to mock
        fallbackMock(address);
      }
    } else {
      toast.info("Brak klucza API — używam danych demo. Dodaj klucz w Ustawieniach.");
      fallbackMock(address);
    }

    setIsLoading(false);
  };

  const fallbackMock = (address: string) => {
    const data = { ...mockWalletData, address };
    setWalletData(data);
    setTokens([]);
    setTrades([]);
    setScoreBreakdown(null);
    addEntry({ address: data.address, smartScore: data.smartScore, status: data.status });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold mb-1">Analiza Portfela</h1>
          <p className="text-sm text-muted-foreground">Wklej adres Solana i uzyskaj pełną analizę aktywności</p>
        </div>
        {walletData && (
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono border ${
            isLive
              ? "text-primary border-primary/30 bg-primary/10"
              : "text-neon-amber border-neon-amber/30 bg-neon-amber/10"
          }`}>
            {isLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {isLive ? "LIVE blockchain" : "Demo data"}
          </div>
        )}
      </div>

      <BlockchainStatus />
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
            <div className="lg:col-span-1 space-y-6">
              <ScoreDisplay data={walletData} />
              {scoreBreakdown && <ScoreBreakdown breakdown={scoreBreakdown} />}
            </div>
            <div className="lg:col-span-2 space-y-6">
              <ActivityChart hourlyActivity={walletData.hourlyActivity} />
              <PatternAnalysis data={walletData} />
              {tokens.length > 0 && <TokenHoldings tokens={tokens} />}
              {tokens.length > 0 && <TokenSecurityAnalysis tokens={tokens} />}
              {trades.length > 0 && <TradeHistory trades={trades} />}
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
            {!getHeliusApiKey() && (
              <p className="text-neon-amber text-xs mt-2">
                ⚠️ Brak klucza Helius API — przejdź do Ustawień, aby połączyć się z Solana
              </p>
            )}
          </div>

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

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return `${seconds} sekund temu`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minut temu`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} godzin temu`;
  return `${Math.floor(seconds / 86400)} dni temu`;
}

export default Analyze;
