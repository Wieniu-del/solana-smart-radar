import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  TrendingUp, TrendingDown, Clock, DollarSign, Target,
  ArrowUpRight, ArrowDownRight, BarChart3, Shield, ExternalLink,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from "recharts";

interface Position {
  id: string;
  token_symbol: string | null;
  token_mint: string;
  entry_price_usd: number;
  current_price_usd: number;
  highest_price_usd: number;
  amount_sol: number;
  pnl_pct: number | null;
  opened_at: string;
  closed_at?: string | null;
  close_reason?: string | null;
  stop_price_usd?: number | null;
  status: string;
  token_amount?: number | null;
}

interface Props {
  position: Position | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const REASON_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  stop_loss: { label: "Stop Loss", icon: "🔴", color: "text-destructive" },
  trailing_stop: { label: "Trailing Stop", icon: "🟡", color: "text-neon-amber" },
  take_profit: { label: "Take Profit", icon: "🟢", color: "text-primary" },
  dead_token: { label: "Dead Token", icon: "💀", color: "text-muted-foreground" },
  profit_fade: { label: "Profit Fade", icon: "🟠", color: "text-neon-amber" },
  fast_loss_cut: { label: "Fast Loss Cut", icon: "⚡", color: "text-destructive" },
  time_decay: { label: "Time Decay", icon: "⏰", color: "text-muted-foreground" },
  manual_sell: { label: "Manual Sell", icon: "🖐️", color: "text-secondary" },
};

function formatPrice(price: number): string {
  if (price === 0) return "$0";
  if (price < 0.0001) return `$${price.toExponential(2)}`;
  if (price < 0.01) return `$${price.toFixed(6)}`;
  if (price < 1) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(2)}`;
}

function timeSince(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

export default function PositionDetailModal({ position, open, onOpenChange }: Props) {
  const [priceHistory, setPriceHistory] = useState<{ time: string; price: number }[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);

  useEffect(() => {
    if (!position || !open) return;
    loadPriceChart(position.token_mint);
  }, [position, open]);

  const loadPriceChart = async (mint: string) => {
    setLoadingChart(true);
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
      const best = pairs
        .filter((p: any) => Number(p?.priceUsd) > 0)
        .sort((a: any, b: any) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0))[0];

      if (best?.priceChange) {
        // Generate synthetic chart from price changes
        const currentPrice = Number(best.priceUsd);
        const changes = [
          { label: "24h", pct: best.priceChange.h24 },
          { label: "6h", pct: best.priceChange.h6 },
          { label: "1h", pct: best.priceChange.h1 },
          { label: "5m", pct: best.priceChange.m5 },
        ];

        const points: { time: string; price: number }[] = [];
        for (const c of changes) {
          const pct = Number(c.pct) || 0;
          const historicPrice = currentPrice / (1 + pct / 100);
          points.push({ time: c.label + " temu", price: historicPrice });
        }
        points.push({ time: "Teraz", price: currentPrice });
        setPriceHistory(points);
      } else {
        setPriceHistory([]);
      }
    } catch {
      setPriceHistory([]);
    } finally {
      setLoadingChart(false);
    }
  };

  if (!position) return null;

  const pnl = position.pnl_pct || 0;
  const isUp = pnl >= 0;
  const pnlSol = (pnl / 100) * position.amount_sol;
  const reason = position.close_reason ? REASON_LABELS[position.close_reason] : null;
  const isClosed = position.status === "closed";
  const highPnl = position.highest_price_usd > 0 && position.entry_price_usd > 0
    ? ((position.highest_price_usd - position.entry_price_usd) / position.entry_price_usd) * 100
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isUp ? "bg-primary" : "bg-destructive"}`} />
            <span className="text-xl font-black">
              {position.token_symbol || position.token_mint.slice(0, 8)}
            </span>
            {isClosed && reason && (
              <span className={`text-xs px-2 py-0.5 rounded border border-border ${reason.color}`}>
                {reason.icon} {reason.label}
              </span>
            )}
            {!isClosed && (
              <span className="text-xs px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/20">
                🟢 Otwarta
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* PnL Hero */}
        <div className={`rounded-lg p-4 text-center ${isUp ? "bg-primary/10 border border-primary/20" : "bg-destructive/10 border border-destructive/20"}`}>
          <div className="flex items-center justify-center gap-2 mb-1">
            {isUp ? <TrendingUp className="h-5 w-5 text-primary" /> : <TrendingDown className="h-5 w-5 text-destructive" />}
            <span className={`text-3xl font-black font-mono ${isUp ? "text-primary" : "text-destructive"}`}>
              {isUp ? "+" : ""}{pnl.toFixed(2)}%
            </span>
          </div>
          <p className={`text-sm font-mono ${isUp ? "text-primary/80" : "text-destructive/80"}`}>
            {isUp ? "+" : ""}{pnlSol.toFixed(4)} SOL
          </p>
        </div>

        {/* Price Chart */}
        <div className="rounded-lg bg-muted/20 border border-border p-3">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Wykres cenowy</span>
          </div>
          {loadingChart ? (
            <div className="h-[120px] flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : priceHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={priceHistory}>
                <defs>
                  <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={isUp ? "hsl(155, 100%, 50%)" : "hsl(0, 80%, 55%)"} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={isUp ? "hsl(155, 100%, 50%)" : "hsl(0, 80%, 55%)"} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone" dataKey="price" stroke={isUp ? "hsl(155, 100%, 50%)" : "hsl(0, 80%, 55%)"}
                  strokeWidth={2} fill="url(#priceGrad)" dot={false}
                />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(220,10%,55%)" }} axisLine={false} tickLine={false} />
                <YAxis hide domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "hsl(220, 20%, 12%)", border: "1px solid hsl(220,15%,20%)", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [formatPrice(v), "Cena"]}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[120px] flex items-center justify-center text-xs text-muted-foreground">
              Brak danych wykresu
            </div>
          )}
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-3">
          <DetailItem icon={DollarSign} label="Cena wejścia" value={formatPrice(position.entry_price_usd)} />
          <DetailItem icon={Target} label={isClosed ? "Cena wyjścia" : "Aktualna cena"}
            value={formatPrice(position.current_price_usd)}
            valueColor={isUp ? "text-primary" : "text-destructive"} />
          <DetailItem icon={ArrowUpRight} label="Najwyższa cena (ATH)" value={formatPrice(position.highest_price_usd)}
            sub={`+${highPnl.toFixed(1)}% od wejścia`} />
          <DetailItem icon={Shield} label="Stop Price"
            value={position.stop_price_usd ? formatPrice(position.stop_price_usd) : "—"} />
          <DetailItem icon={Clock} label={isClosed ? "Czas trwania" : "Czas otwarcia"}
            value={timeSince(position.opened_at)} />
          <DetailItem icon={DollarSign} label="Wielkość pozycji"
            value={`${position.amount_sol} SOL`}
            sub={position.token_amount ? `${position.token_amount.toLocaleString()} tokenów` : undefined} />
        </div>

        {/* DexScreener Link */}
        <a
          href={`https://dexscreener.com/solana/${position.token_mint}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-xs text-primary hover:underline py-2"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Otwórz na DexScreener
        </a>
      </DialogContent>
    </Dialog>
  );
}

function DetailItem({ icon: Icon, label, value, valueColor = "text-foreground", sub }: {
  icon: React.ElementType; label: string; value: string; valueColor?: string; sub?: string;
}) {
  return (
    <div className="bg-muted/20 rounded-lg p-2.5 border border-border">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-sm font-bold font-mono ${valueColor}`}>{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
