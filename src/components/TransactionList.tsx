import { Transaction } from "@/types/wallet";
import { ExternalLink } from "lucide-react";

interface TransactionListProps {
  transactions: Transaction[];
}

const TransactionList = ({ transactions }: TransactionListProps) => {
  const timeAgo = (timestamp: number) => {
    const seconds = Math.floor(Date.now() / 1000 - timestamp);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  return (
    <div className="neon-card rounded-xl p-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Recent Transactions
      </h3>
      <div className="space-y-2">
        {transactions.map((tx, i) => (
          <div
            key={i}
            className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-primary pulse-neon" />
              <span className="font-mono text-sm text-foreground">{tx.signature}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-muted-foreground font-mono">
                {(tx.fee / 1e9).toFixed(6)} SOL
              </span>
              <span className="text-xs text-muted-foreground">{timeAgo(tx.blockTime)}</span>
              <a
                href={`https://solscan.io/tx/${tx.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TransactionList;
