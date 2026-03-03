import { HeliusTokenBalance } from "@/services/helius";
import { Coins, ExternalLink } from "lucide-react";

interface TokenHoldingsProps {
  tokens: HeliusTokenBalance[];
}

const TokenHoldings = ({ tokens }: TokenHoldingsProps) => {
  const totalValue = tokens.reduce((sum, t) => sum + (t.valueUsd || 0), 0);

  return (
    <div className="neon-card rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Coins className="h-4 w-4" /> Tokeny w portfelu
        </h3>
        <span className="text-xs font-mono text-primary font-bold">
          ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {tokens.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Brak tokenów</p>
        )}
        {tokens.map((token, i) => (
          <div
            key={token.mint + i}
            className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group"
          >
            {/* Icon */}
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
              {token.logoURI ? (
                <img src={token.logoURI} alt={token.symbol} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <span className="text-xs font-bold text-muted-foreground">{token.symbol?.slice(0, 2)}</span>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground truncate">{token.symbol}</span>
                <span className="text-[10px] text-muted-foreground truncate">{token.name}</span>
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                {token.amount < 0.001 ? token.amount.toExponential(2) : token.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </div>
            </div>

            {/* Value */}
            <div className="text-right flex-shrink-0">
              {(token.valueUsd || 0) > 0.01 ? (
                <>
                  <div className="text-sm font-mono font-semibold text-foreground">
                    ${token.valueUsd!.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    @${token.priceUsd?.toFixed(token.priceUsd < 0.01 ? 6 : 2)}
                  </div>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">-</span>
              )}
            </div>

            {/* Link */}
            <a
              href={`https://solscan.io/token/${token.mint}`}
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all flex-shrink-0"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TokenHoldings;
