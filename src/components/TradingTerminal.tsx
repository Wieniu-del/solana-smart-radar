import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, X, TrendingUp, TrendingDown, RefreshCw, AlertTriangle,
} from "lucide-react";

interface Position {
  id: string;
  token_mint: string;
  token_symbol: string | null;
  entry_price_usd: number;
  current_price_usd: number;
  highest_price_usd: number;
  amount_sol: number;
  token_amount: number | null;
  trailing_stop_pct: number;
  take_profit_pct: number;
  stop_price_usd: number;
  pnl_pct: number;
  status: string;
  opened_at: string;
  closed_at: string | null;
  close_reason: string | null;
  signal_id: string | null;
}

interface TradeExecution {
  id: string;
  action: string;
  token_mint: string;
  token_symbol: string | null;
  amount_sol: number;
  token_amount: number | null;
  price_usd: number | null;
  status: string;
  tx_signature: string | null;
  error_message: string | null;
  created_at: string;
}

export default function TradingTerminal() {
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [closedPositions, setClosedPositions] = useState<Position[]>([]);
  const [tradeHistory, setTradeHistory] = useState<TradeExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [closingId, setClosingId] = useState<string | null>(null);
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [openRes, closedRes, tradesRes] = await Promise.all([
        supabase.from("open_positions").select("*").eq("status", "open").order("opened_at", { ascending: false }),
        supabase.from("open_positions").select("*").eq("status", "closed").order("closed_at", { ascending: false }).limit(50),
        supabase.from("trade_executions").select("*").order("created_at", { ascending: false }).limit(50),
      ]);
      if (openRes.data) setOpenPositions(openRes.data as Position[]);
      if (closedRes.data) setClosedPositions(closedRes.data as Position[]);
      if (tradesRes.data) setTradeHistory(tradesRes.data as TradeExecution[]);
    } catch (e: any) {
      toast({ title: "Błąd", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("terminal-positions")
      .on("postgres_changes", { event: "*", schema: "public", table: "open_positions" }, () => {
        supabase.from("open_positions").select("*").eq("status", "open").order("opened_at", { ascending: false })
          .then(({ data }) => { if (data) setOpenPositions(data as Position[]); });
        supabase.from("open_positions").select("*").eq("status", "closed").order("closed_at", { ascending: false }).limit(50)
          .then(({ data }) => { if (data) setClosedPositions(data as Position[]); });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "trade_executions" }, () => {
        supabase.from("trade_executions").select("*").order("created_at", { ascending: false }).limit(50)
          .then(({ data }) => { if (data) setTradeHistory(data as TradeExecution[]); });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Auto-refresh prices every 15s
  useEffect(() => {
    const iv = setInterval(async () => {
      const { data } = await supabase.from("open_positions").select("*").eq("status", "open").order("opened_at", { ascending: false });
      if (data) setOpenPositions(data as Position[]);
    }, 15000);
    return () => clearInterval(iv);
  }, []);

  async function closePositionManually(pos: Position) {
    setClosingId(pos.id);
    try {
      // 1. Execute SELL via edge function
      const { data: swapData, error: swapErr } = await supabase.functions.invoke("execute-swap", {
        body: {
          action: "SELL",
          tokenMint: pos.token_mint,
          amountSol: pos.token_amount || pos.amount_sol,
          slippageBps: 300,
        },
      });
      if (swapErr) throw swapErr;

      const entry = Number(pos.entry_price_usd) || 0;
      const current = Number(pos.current_price_usd) || 0;
      const pnlPct = entry > 0 ? ((current - entry) / entry) * 100 : 0;

      // 2. Update position as closed
      await supabase.from("open_positions").update({
        status: "closed",
        close_reason: "manual",
        pnl_pct: Math.round(pnlPct * 100) / 100,
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", pos.id);

      // 3. Add notification
      await supabase.from("notifications").insert({
        type: "position_closed",
        title: `⚪ Ręczne zamknięcie — ${pos.token_symbol || "???"}`,
        message: `Pozycja zamknięta ręcznie. PnL: ${pnlPct.toFixed(1)}%`,
        details: {
          position_id: pos.id,
          token_mint: pos.token_mint,
          close_reason: "manual",
          pnl_pct: pnlPct,
          tx: swapData?.txSignature || null,
        },
      });

      toast({ title: `✅ Pozycja ${pos.token_symbol} zamknięta`, description: `PnL: ${pnlPct.toFixed(1)}%` });
    } catch (e: any) {
      toast({ title: "Błąd zamykania", description: e.message, variant: "destructive" });
    } finally {
      setClosingId(null);
    }
  }

  const fmtPrice = (v: number) => {
    if (v <= 0) return "—";
    if (v < 0.001) return `$${v.toFixed(8)}`;
    if (v < 1) return `$${v.toFixed(6)}`;
    return `$${v.toFixed(4)}`;
  };

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const totalPnlSol = openPositions.reduce((sum, p) => {
    const entry = Number(p.entry_price_usd) || 0;
    const current = Number(p.current_price_usd) || 0;
    const pnl = entry > 0 ? ((current - entry) / entry) * Number(p.amount_sol) : 0;
    return sum + pnl;
  }, 0);

  const reasonLabels: Record<string, string> = {
    stop_loss: "🔴 Stop-Loss",
    trailing_stop: "🟡 Trailing Stop",
    take_profit: "🟢 Take-Profit",
    manual: "⚪ Ręczne",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Bybit-style tab bar */}
      <Tabs defaultValue="positions" className="w-full">
        <div className="border-b border-border bg-muted/30 px-1">
          <TabsList className="bg-transparent h-10 gap-0 rounded-none">
            <TabsTrigger
              value="positions"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs px-4"
            >
              Pozycje ({openPositions.length})
            </TabsTrigger>
            <TabsTrigger
              value="closed"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs px-4"
            >
              Historia pozycji ({closedPositions.length})
            </TabsTrigger>
            <TabsTrigger
              value="trades"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs px-4"
            >
              Historia transakcji
            </TabsTrigger>
            <TabsTrigger
              value="pnl"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs px-4"
            >
              P&L
            </TabsTrigger>
          </TabsList>
          <div className="absolute right-2 top-1.5">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={loadData}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* ═══ OPEN POSITIONS ═══ */}
        <TabsContent value="positions" className="mt-0">
          {openPositions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Brak otwartych pozycji
            </div>
          ) : (
            <div className="overflow-x-auto">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_80px_100px_100px_100px_90px_80px_80px_90px_70px] gap-0 px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/20 min-w-[900px]">
                <span>Token</span>
                <span>Wielkość</span>
                <span>Cena wejścia</span>
                <span>Cena aktualna</span>
                <span>Cena max</span>
                <span>PnL (%)</span>
                <span>PnL (SOL)</span>
                <span>SL / TP</span>
                <span>Czas</span>
                <span className="text-center">Akcja</span>
              </div>
              {/* Rows */}
              <div className="min-w-[900px]">
                {openPositions.map((pos) => {
                  const entry = Number(pos.entry_price_usd) || 0;
                  const current = Number(pos.current_price_usd) || 0;
                  const highest = Number(pos.highest_price_usd) || 0;
                  const stopPrice = Number(pos.stop_price_usd) || 0;
                  const amountSol = Number(pos.amount_sol) || 0;
                  const pnl = entry > 0 ? ((current - entry) / entry) * 100 : (Number(pos.pnl_pct) || 0);
                  const isPos = pnl >= 0;
                  const pnlSol = entry > 0 ? (pnl / 100) * amountSol : 0;
                  const distToSL = current > 0 && stopPrice > 0 ? ((current - stopPrice) / current) * 100 : null;

                  return (
                    <div
                      key={pos.id}
                      className="grid grid-cols-[1fr_80px_100px_100px_100px_90px_80px_80px_90px_70px] gap-0 px-3 py-2.5 text-xs border-b border-border/50 hover:bg-muted/10 transition-colors items-center"
                    >
                      {/* Token */}
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${isPos ? "bg-primary" : "bg-destructive"} shrink-0`} />
                        <span className="font-semibold text-foreground text-sm">{pos.token_symbol || "???"}</span>
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">LONG</Badge>
                      </div>
                      {/* Size */}
                      <span className="text-foreground font-medium">{amountSol.toFixed(3)} SOL</span>
                      {/* Entry */}
                      <span className="text-muted-foreground font-mono text-[11px]">{fmtPrice(entry)}</span>
                      {/* Current */}
                      <span className={`font-mono text-[11px] font-semibold ${isPos ? "text-primary" : "text-destructive"}`}>
                        {fmtPrice(current)}
                      </span>
                      {/* Highest */}
                      <span className="text-muted-foreground font-mono text-[11px]">{fmtPrice(highest)}</span>
                      {/* PnL % */}
                      <span className={`font-bold text-sm ${isPos ? "text-primary" : "text-destructive"}`}>
                        {isPos ? "+" : ""}{pnl.toFixed(2)}%
                      </span>
                      {/* PnL SOL */}
                      <span className={`text-[11px] font-medium ${isPos ? "text-primary" : "text-destructive"}`}>
                        {isPos ? "+" : ""}{pnlSol.toFixed(4)}
                      </span>
                      {/* SL/TP */}
                      <div className="text-[10px] text-muted-foreground leading-tight">
                        <div>SL: {pos.trailing_stop_pct}%</div>
                        <div>TP: {pos.take_profit_pct}%</div>
                        {distToSL !== null && (
                          <div className={distToSL < 3 ? "text-destructive font-medium" : ""}>
                            ({distToSL.toFixed(1)}% do SL)
                          </div>
                        )}
                      </div>
                      {/* Time */}
                      <span className="text-[10px] text-muted-foreground">{timeAgo(pos.opened_at)}</span>
                      {/* Action */}
                      <div className="text-center">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-6 px-2 text-[10px]"
                          disabled={closingId === pos.id}
                          onClick={() => {
                            if (confirm(`Zamknąć pozycję ${pos.token_symbol}?`)) {
                              closePositionManually(pos);
                            }
                          }}
                        >
                          {closingId === pos.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <X className="h-3 w-3" />
                          )}
                          <span className="ml-0.5">Zamknij</span>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Footer summary */}
              <div className="px-3 py-2 border-t border-border bg-muted/20 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Razem: <span className="text-foreground font-medium">{openPositions.length}</span> pozycji
                </span>
                <span className={`font-bold ${totalPnlSol >= 0 ? "text-primary" : "text-destructive"}`}>
                  Σ PnL: {totalPnlSol >= 0 ? "+" : ""}{totalPnlSol.toFixed(4)} SOL
                </span>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ═══ CLOSED POSITIONS ═══ */}
        <TabsContent value="closed" className="mt-0">
          {closedPositions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Brak zamkniętych pozycji
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="grid grid-cols-[1fr_80px_100px_100px_90px_80px_120px_100px] gap-0 px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/20 min-w-[800px]">
                <span>Token</span>
                <span>Wielkość</span>
                <span>Cena wejścia</span>
                <span>Cena wyjścia</span>
                <span>PnL (%)</span>
                <span>PnL (SOL)</span>
                <span>Powód zamknięcia</span>
                <span>Data zamknięcia</span>
              </div>
              <div className="min-w-[800px] max-h-[400px] overflow-y-auto">
                {closedPositions.map((pos) => {
                  const pnl = Number(pos.pnl_pct) || 0;
                  const isPos = pnl >= 0;
                  const pnlSol = (pnl / 100) * Number(pos.amount_sol);

                  return (
                    <div
                      key={pos.id}
                      className="grid grid-cols-[1fr_80px_100px_100px_90px_80px_120px_100px] gap-0 px-3 py-2 text-xs border-b border-border/30 hover:bg-muted/10 items-center"
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${isPos ? "bg-primary" : "bg-destructive"} shrink-0`} />
                        <span className="font-medium text-foreground">{pos.token_symbol || "???"}</span>
                      </div>
                      <span className="text-muted-foreground">{Number(pos.amount_sol).toFixed(3)} SOL</span>
                      <span className="text-muted-foreground font-mono text-[11px]">{fmtPrice(Number(pos.entry_price_usd))}</span>
                      <span className="text-muted-foreground font-mono text-[11px]">{fmtPrice(Number(pos.current_price_usd))}</span>
                      <span className={`font-bold ${isPos ? "text-primary" : "text-destructive"}`}>
                        {isPos ? "+" : ""}{pnl.toFixed(2)}%
                      </span>
                      <span className={`text-[11px] ${isPos ? "text-primary" : "text-destructive"}`}>
                        {isPos ? "+" : ""}{pnlSol.toFixed(4)}
                      </span>
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 w-fit">
                        {reasonLabels[pos.close_reason || ""] || pos.close_reason || "—"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {pos.closed_at ? fmtTime(pos.closed_at) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ═══ TRADE HISTORY ═══ */}
        <TabsContent value="trades" className="mt-0">
          {tradeHistory.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Brak historii transakcji
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="grid grid-cols-[1fr_70px_80px_100px_80px_80px_140px_100px] gap-0 px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/20 min-w-[800px]">
                <span>Token</span>
                <span>Kierunek</span>
                <span>Wielkość</span>
                <span>Cena</span>
                <span>Ilość</span>
                <span>Status</span>
                <span>TX</span>
                <span>Data</span>
              </div>
              <div className="min-w-[800px] max-h-[400px] overflow-y-auto">
                {tradeHistory.map((tx) => {
                  const isBuy = tx.action === "BUY";
                  return (
                    <div
                      key={tx.id}
                      className="grid grid-cols-[1fr_70px_80px_100px_80px_80px_140px_100px] gap-0 px-3 py-2 text-xs border-b border-border/30 hover:bg-muted/10 items-center"
                    >
                      <span className="font-medium text-foreground">{tx.token_symbol || tx.token_mint.slice(0, 8) + "..."}</span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1.5 py-0 w-fit ${isBuy ? "text-primary border-primary/40" : "text-destructive border-destructive/40"}`}
                      >
                        {isBuy ? "KUP" : "SPRZEDAJ"}
                      </Badge>
                      <span className="text-muted-foreground">{Number(tx.amount_sol).toFixed(3)} SOL</span>
                      <span className="text-muted-foreground font-mono text-[11px]">
                        {tx.price_usd ? fmtPrice(Number(tx.price_usd)) : "—"}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        {tx.token_amount ? Number(tx.token_amount).toLocaleString("pl-PL", { maximumFractionDigits: 2 }) : "—"}
                      </span>
                      <Badge
                        variant={tx.status === "completed" ? "default" : tx.status === "failed" ? "destructive" : "secondary"}
                        className="text-[9px] px-1.5 py-0 w-fit"
                      >
                        {tx.status === "completed" ? "Wykonano" : tx.status === "failed" ? "Błąd" : tx.status === "pending" ? "Oczekuje" : tx.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground font-mono truncate">
                        {tx.tx_signature ? tx.tx_signature.slice(0, 16) + "..." : tx.error_message?.slice(0, 20) || "—"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{fmtTime(tx.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ═══ P&L SUMMARY ═══ */}
        <TabsContent value="pnl" className="mt-0">
          <PnLSummary open={openPositions} closed={closedPositions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── P&L Summary ───
function PnLSummary({ open, closed }: { open: Position[]; closed: Position[] }) {
  const totalClosedPnl = closed.reduce((s, p) => s + ((Number(p.pnl_pct) || 0) / 100) * Number(p.amount_sol), 0);
  const totalOpenPnl = open.reduce((s, p) => {
    const e = Number(p.entry_price_usd) || 0;
    const c = Number(p.current_price_usd) || 0;
    return s + (e > 0 ? ((c - e) / e) * Number(p.amount_sol) : 0);
  }, 0);

  const wins = closed.filter(p => (Number(p.pnl_pct) || 0) > 0).length;
  const losses = closed.filter(p => (Number(p.pnl_pct) || 0) < 0).length;
  const winRate = closed.length > 0 ? (wins / closed.length * 100) : 0;

  const totalInvested = [...open, ...closed].reduce((s, p) => s + Number(p.amount_sol), 0);

  const stats = [
    { label: "Otwarte pozycje", value: open.length.toString(), color: "text-foreground" },
    { label: "Zamknięte pozycje", value: closed.length.toString(), color: "text-foreground" },
    { label: "Niezrealizowany PnL", value: `${totalOpenPnl >= 0 ? "+" : ""}${totalOpenPnl.toFixed(4)} SOL`, color: totalOpenPnl >= 0 ? "text-primary" : "text-destructive" },
    { label: "Zrealizowany PnL", value: `${totalClosedPnl >= 0 ? "+" : ""}${totalClosedPnl.toFixed(4)} SOL`, color: totalClosedPnl >= 0 ? "text-primary" : "text-destructive" },
    { label: "Łączny PnL", value: `${(totalOpenPnl + totalClosedPnl) >= 0 ? "+" : ""}${(totalOpenPnl + totalClosedPnl).toFixed(4)} SOL`, color: (totalOpenPnl + totalClosedPnl) >= 0 ? "text-primary" : "text-destructive" },
    { label: "Win Rate", value: `${winRate.toFixed(1)}%`, color: winRate >= 50 ? "text-primary" : "text-destructive" },
    { label: "Wygrane / Przegrane", value: `${wins} / ${losses}`, color: "text-foreground" },
    { label: "Zainwestowano łącznie", value: `${totalInvested.toFixed(3)} SOL`, color: "text-foreground" },
  ];

  return (
    <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((s, i) => (
        <div key={i} className="bg-muted/20 rounded-lg p-3 border border-border/50">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{s.label}</p>
          <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}
