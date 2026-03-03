import { ParsedTrade } from "@/services/helius";
import { ArrowRightLeft, ArrowDownLeft, ArrowUpRight, Send, ExternalLink } from "lucide-react";

interface TradeHistoryProps {
  trades: ParsedTrade[];
}

const typeConfig = {
  BUY: { icon: ArrowDownLeft, label: "Kupno", color: "text-primary", bg: "bg-primary/10" },
  SELL: { icon: ArrowUpRight, label: "Sprzedaż", color: "text-neon-red", bg: "bg-neon-red/10" },
  SWAP: { icon: ArrowRightLeft, label: "Swap", color: "text-neon-cyan", bg: "bg-neon-cyan/10" },
  TRANSFER: { icon: Send, label: "Transfer", color: "text-neon-amber", bg: "bg-neon-amber/10" },
};

const TradeHistory = ({ trades }: TradeHistoryProps) => {
  const timeAgo = (ts: number) => {
    const sec = Math.floor(Date.now() / 1000 - ts);
    if (sec < 60) return `${sec}s temu`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m temu`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h temu`;
    return `${Math.floor(sec / 86400)}d temu`;
  };

  return (
    <div className="neon-card rounded-xl p-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
        <ArrowRightLeft className="h-4 w-4" /> Historia Transakcji Tokenów
      </h3>
      <div className="space-y-2 max-h-[450px] overflow-y-auto">
        {trades.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Brak transakcji tokenów</p>
        )}
        {trades.slice(0, 30).map((trade, i) => {
          const cfg = typeConfig[trade.type];
          const Icon = cfg.icon;

          return (
            <div
              key={trade.signature + i}
              className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group"
            >
              {/* Type badge */}
              <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
                <Icon className={`h-4 w-4 ${cfg.color}`} />
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-bold uppercase ${cfg.color}`}>{cfg.label}</span>
                  <span className="text-[10px] text-muted-foreground">{trade.source}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                  {trade.tokenIn && (
                    <span className="font-mono">
                      -{trade.tokenIn.amount < 0.001 ? trade.tokenIn.amount.toExponential(2) : trade.tokenIn.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {trade.tokenIn.symbol}
                    </span>
                  )}
                  {trade.tokenIn && trade.tokenOut && <span className="text-muted-foreground">→</span>}
                  {trade.tokenOut && (
                    <span className="font-mono text-primary">
                      +{trade.tokenOut.amount < 0.001 ? trade.tokenOut.amount.toExponential(2) : trade.tokenOut.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {trade.tokenOut.symbol}
                    </span>
                  )}
                </div>
              </div>

              {/* Time */}
              <span className="text-[10px] text-muted-foreground flex-shrink-0">{timeAgo(trade.timestamp)}</span>

              {/* Link */}
              <a
                href={`https://solscan.io/tx/${trade.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all flex-shrink-0"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TradeHistory;
