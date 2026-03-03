import { useState } from "react";
import { Search, ArrowLeftRight, Loader2 } from "lucide-react";
import { WalletData, mockWalletData, generateMockWallet } from "@/types/wallet";
import ScoreDisplay from "@/components/ScoreDisplay";
import ActivityChart from "@/components/ActivityChart";
import PatternAnalysis from "@/components/PatternAnalysis";

const Compare = () => {
  const [addressA, setAddressA] = useState("");
  const [addressB, setAddressB] = useState("");
  const [walletA, setWalletA] = useState<WalletData | null>(null);
  const [walletB, setWalletB] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCompare = async () => {
    if (!addressA.trim() || !addressB.trim()) return;
    setLoading(true);
    try {
      // Try fetching both from API, fallback to mock
      const [resA, resB] = await Promise.allSettled([
        fetch(`/api/wallet/${encodeURIComponent(addressA.trim())}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/wallet/${encodeURIComponent(addressB.trim())}`).then(r => r.ok ? r.json() : null),
      ]);
      setWalletA(resA.status === "fulfilled" && resA.value ? resA.value : generateMockWallet(addressA.trim()));
      setWalletB(resB.status === "fulfilled" && resB.value ? resB.value : generateMockWallet(addressB.trim()));
    } catch {
      setWalletA(generateMockWallet(addressA.trim()));
      setWalletB(generateMockWallet(addressB.trim()));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold mb-1">Porównywarka portfeli</h1>
        <p className="text-sm text-muted-foreground">Porównaj dwa portfele Solana side-by-side</p>
      </div>

      {/* Input Row */}
      <div className="flex flex-col md:flex-row items-center gap-3">
        <div className="flex-1 w-full">
          <input
            type="text" value={addressA} onChange={(e) => setAddressA(e.target.value)}
            placeholder="Adres portfela A..."
            className="w-full bg-muted rounded-lg border border-border px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:neon-border"
          />
        </div>
        <ArrowLeftRight className="h-5 w-5 text-muted-foreground shrink-0" />
        <div className="flex-1 w-full">
          <input
            type="text" value={addressB} onChange={(e) => setAddressB(e.target.value)}
            placeholder="Adres portfela B..."
            className="w-full bg-muted rounded-lg border border-border px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:neon-border"
          />
        </div>
        <button
          onClick={handleCompare}
          disabled={loading || !addressA.trim() || !addressB.trim()}
          className="px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm shrink-0"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "PORÓWNAJ"}
        </button>
      </div>

      {/* Results */}
      {walletA && walletB && (
        <div className="space-y-6" style={{ animation: "fade-in-up 0.5s ease-out" }}>
          {/* Score comparison header */}
          <div className="neon-card rounded-xl p-6">
            <div className="grid grid-cols-3 items-center">
              <div className="text-center">
                <div className="text-xs font-mono text-muted-foreground mb-1 truncate">{walletA.address.slice(0, 8)}...</div>
                <div className="text-3xl font-bold font-mono neon-glow">{walletA.smartScore}</div>
              </div>
              <div className="text-center">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">vs</span>
                <div className="mt-1">
                  {walletA.smartScore > walletB.smartScore
                    ? <span className="text-xs text-primary font-semibold">A wygrywa o {walletA.smartScore - walletB.smartScore} pkt</span>
                    : walletB.smartScore > walletA.smartScore
                    ? <span className="text-xs text-secondary font-semibold">B wygrywa o {walletB.smartScore - walletA.smartScore} pkt</span>
                    : <span className="text-xs text-muted-foreground font-semibold">Remis</span>}
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs font-mono text-muted-foreground mb-1 truncate">{walletB.address.slice(0, 8)}...</div>
                <div className="text-3xl font-bold font-mono" style={{ textShadow: "0 0 10px hsl(185 100% 50% / 0.8)" }}>{walletB.smartScore}</div>
              </div>
            </div>

            {/* Metric comparison bars */}
            <div className="mt-6 space-y-3">
              <CompareBar label="TX 24h" a={walletA.transactionCount24h} b={walletB.transactionCount24h} />
              <CompareBar label="Total TX" a={walletA.totalTransactions} b={walletB.totalTransactions} />
              <CompareBar label="Score" a={walletA.smartScore} b={walletB.smartScore} />
            </div>
          </div>

          {/* Side by side details */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Portfel A</h3>
              <ScoreDisplay data={walletA} />
              <ActivityChart hourlyActivity={walletA.hourlyActivity} />
              <PatternAnalysis data={walletA} />
            </div>
            <div className="space-y-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Portfel B</h3>
              <ScoreDisplay data={walletB} />
              <ActivityChart hourlyActivity={walletB.hourlyActivity} />
              <PatternAnalysis data={walletB} />
            </div>
          </div>
        </div>
      )}

      {!walletA && !walletB && !loading && (
        <div className="text-center py-20">
          <ArrowLeftRight className="h-16 w-16 mx-auto text-muted-foreground/20 mb-4" />
          <p className="text-muted-foreground text-sm">Wklej dwa adresy portfeli Solana aby je porównać</p>
        </div>
      )}
    </div>
  );
};

function CompareBar({ label, a, b }: { label: string; a: number; b: number }) {
  const max = Math.max(a, b, 1);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-mono text-foreground w-8 text-right">{a}</span>
      <div className="flex-1 flex h-2 gap-0.5">
        <div className="flex-1 bg-muted rounded-l-full overflow-hidden flex justify-end">
          <div className="bg-primary h-full rounded-l-full" style={{ width: `${(a / max) * 100}%` }} />
        </div>
        <div className="flex-1 bg-muted rounded-r-full overflow-hidden">
          <div className="bg-secondary h-full rounded-r-full" style={{ width: `${(b / max) * 100}%` }} />
        </div>
      </div>
      <span className="text-xs font-mono text-foreground w-8">{b}</span>
      <span className="text-[10px] text-muted-foreground w-16">{label}</span>
    </div>
  );
}

export default Compare;
