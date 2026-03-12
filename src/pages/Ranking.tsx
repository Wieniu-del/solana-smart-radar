import { useMemo, useState } from "react";
import { Trophy, ArrowUpDown, Search, Copy, ExternalLink } from "lucide-react";
import { mockTopWallets, WalletData } from "@/types/wallet";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type SortKey = "smartScore" | "transactionCount24h" | "totalTransactions";

const Ranking = () => {
  const wallets = useMemo<WalletData[]>(() => {
    // Use real wallet addresses - no duplicates
    const seen = new Set<string>();
    const all: WalletData[] = [];
    for (const w of mockTopWallets) {
      if (!seen.has(w.address)) {
        seen.add(w.address);
        all.push(w);
      }
    }
    return all.sort((a, b) => b.smartScore - a.smartScore);
  }, []);

  const [sortKey, setSortKey] = useState<SortKey>("smartScore");
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState("");

  const sorted = useMemo(() => {
    let list = [...wallets];
    if (filter) {
      list = list.filter(w => w.address.toLowerCase().includes(filter.toLowerCase()));
    }
    list.sort((a, b) => sortAsc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]);
    return list;
  }, [wallets, sortKey, sortAsc, filter]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    toast.success("Adres skopiowany!");
  };

  const statusBadge = (status: WalletData["status"]) => {
    const map = {
      "High Activity": "text-neon-red bg-neon-red/10",
      "Active": "text-primary bg-primary/10",
      "Moderate": "text-neon-amber bg-neon-amber/10",
      "Dormant": "text-muted-foreground bg-muted",
    };
    return <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${map[status]}`}>{status}</span>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold mb-1">Ranking Smart Wallets</h1>
        <p className="text-sm text-muted-foreground">Top 50 najbardziej aktywnych portfeli w ostatnich 24h</p>
      </div>

      {/* Filter */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtruj po adresie..."
          className="w-full bg-muted rounded-lg border border-border pl-10 pr-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:neon-border"
        />
      </div>

      {/* Table */}
      <div className="neon-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-[10px] text-muted-foreground uppercase tracking-wider w-12">#</th>
                <th className="text-left px-4 py-3 text-[10px] text-muted-foreground uppercase tracking-wider">Adres portfela</th>
                <th className="text-left px-4 py-3 text-[10px] text-muted-foreground uppercase tracking-wider">Status</th>
                <SortHeader label="Smart Score" sortKey="smartScore" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} />
                <SortHeader label="TX 24h" sortKey="transactionCount24h" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} />
                <SortHeader label="Total TX" sortKey="totalTransactions" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} />
                <th className="text-left px-4 py-3 text-[10px] text-muted-foreground uppercase tracking-wider">Ostatnia aktywność</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((w, i) => (
                <tr key={w.address} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link to={`/analyze?address=${encodeURIComponent(w.address)}`} className="text-xs font-mono text-foreground hover:text-primary transition-colors break-all">
                        {w.address}
                      </Link>
                      <button
                        onClick={() => copyAddress(w.address)}
                        className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                        title="Kopiuj adres"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <a
                        href={`https://solscan.io/account/${w.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                        title="Zobacz na Solscan"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </td>
                  <td className="px-4 py-3">{statusBadge(w.status)}</td>
                  <td className="px-4 py-3">
                    <ScoreBar score={w.smartScore} />
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-foreground">{w.transactionCount24h}</td>
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{w.totalTransactions.toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{w.lastActivityAge}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

function SortHeader({ label, sortKey, currentKey, asc, onSort }: {
  label: string; sortKey: SortKey; currentKey: SortKey; asc: boolean; onSort: (k: SortKey) => void;
}) {
  const active = sortKey === currentKey;
  return (
    <th className="text-left px-4 py-3">
      <button onClick={() => onSort(sortKey)} className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? "text-primary" : ""}`} />
      </button>
    </th>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score > 70 ? "bg-neon-red" : score > 40 ? "bg-primary" : score > 20 ? "bg-neon-amber" : "bg-muted-foreground";
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono font-bold text-foreground w-6">{score}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-[80px]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

export default Ranking;
