import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loader2, X, RefreshCw } from "lucide-react";

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

  // Auto-refresh every 5s for live PnL
  useEffect(() => {
    const iv = setInterval(async () => {
      const { data } = await supabase.from("open_positions").select("*").eq("status", "open").order("opened_at", { ascending: false });
      if (data) setOpenPositions(data as Position[]);
    }, 5000);
    return () => clearInterval(iv);
  }, []);

  async function closePositionManually(pos: Position) {
    setClosingId(pos.id);
    try {
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

      await supabase.from("open_positions").update({
        status: "closed",
        close_reason: "manual",
        pnl_pct: Math.round(pnlPct * 100) / 100,
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", pos.id);

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

      toast({ title: `✅ ${pos.token_symbol} zamknięta`, description: `PnL: ${pnlPct.toFixed(1)}%` });
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
    new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (d > 0) return `${d}d ${h}h`;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const totalPnlSol = openPositions.reduce((sum, p) => {
    const entry = Number(p.entry_price_usd) || 0;
    const current = Number(p.current_price_usd) || 0;
    const pnl = entry > 0 ? ((current - entry) / entry) * Number(p.amount_sol) : 0;
    return sum + pnl;
  }, 0);

  const reasonLabels: Record<string, { label: string; color: string; bg: string }> = {
    stop_loss: { label: "🔴 Stop-Loss", color: "text-destructive", bg: "bg-destructive/15 border-destructive/30" },
    fast_loss_cut: { label: "⚡ Fast Loss Cut", color: "text-destructive", bg: "bg-destructive/15 border-destructive/30" },
    trailing_stop: { label: "🟡 Trailing Stop", color: "text-primary", bg: "bg-primary/15 border-primary/30" },
    take_profit: { label: "🟢 Take-Profit", color: "text-primary", bg: "bg-primary/15 border-primary/30" },
    profit_fade: { label: "🟠 Profit Fade", color: "text-accent-foreground", bg: "bg-accent/15 border-accent/30" },
    time_decay: { label: "⏰ Time Decay", color: "text-muted-foreground", bg: "bg-muted/30 border-border" },
    dead_token: { label: "💀 Dead Token", color: "text-destructive", bg: "bg-destructive/15 border-destructive/30" },
    manual: { label: "⚪ Ręczne", color: "text-muted-foreground", bg: "bg-muted/30 border-border" },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <Tabs defaultValue="positions" className="w-full">
        {/* Tab bar */}
        <div className="border-b border-border bg-muted/30 px-2 flex items-center justify-between">
          <TabsList className="bg-transparent h-12 gap-1 rounded-none">
            <TabsTrigger value="positions" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm font-semibold px-5">
              Pozycje ({openPositions.length})
            </TabsTrigger>
            <TabsTrigger value="closed" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm font-semibold px-5">
              Historia ({closedPositions.length})
            </TabsTrigger>
            <TabsTrigger value="trades" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm font-semibold px-5">
              Transakcje
            </TabsTrigger>
            <TabsTrigger value="pnl" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm font-semibold px-5">
              P&L
            </TabsTrigger>
          </TabsList>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* ═══ OPEN POSITIONS ═══ */}
        <TabsContent value="positions" className="mt-0">
          {openPositions.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-base">
              Brak otwartych pozycji
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableHead className="text-xs font-bold uppercase tracking-wider w-[160px]">Token</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Wielkość</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Cena wejścia</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Cena aktualna</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Cena max</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wider text-right">PnL (%)</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wider text-right">PnL (SOL)</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wider text-center">SL / TP</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Czas</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wider text-center">Akcja</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openPositions.map((pos) => {
                      const entry = Number(pos.entry_price_usd) || 0;
                      const current = Number(pos.current_price_usd) || 0;
                      const highest = Number(pos.highest_price_usd) || 0;
                      const stopPrice = Number(pos.stop_price_usd) || 0;
                      const amountSol = Number(pos.amount_sol) || 0;
                      const rawPnl = entry > 0 ? ((current - entry) / entry) * 100 : (Number(pos.pnl_pct) || 0);
                      const pnl = capPnl(rawPnl);
                      const isPos = pnl >= 0;
                      const pnlSol = (pnl / 100) * amountSol;
                      const distToSL = current > 0 && stopPrice > 0 ? ((current - stopPrice) / current) * 100 : null;

                      return (
                        <TableRow key={pos.id} className="hover:bg-muted/10">
                          {/* Token */}
                          <TableCell className="py-3">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full shrink-0 ${isPos ? "bg-primary" : "bg-destructive"}`} />
                              <span className="font-bold text-foreground text-base">{pos.token_symbol || "???"}</span>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-semibold">LONG</Badge>
                            </div>
                          </TableCell>
                          {/* Size */}
                          <TableCell className="text-right py-3">
                            <span className="text-foreground font-semibold text-sm">{amountSol.toFixed(3)} SOL</span>
                          </TableCell>
                          {/* Entry */}
                          <TableCell className="text-right py-3">
                            <span className="text-muted-foreground font-mono text-sm">{fmtPrice(entry)}</span>
                          </TableCell>
                          {/* Current */}
                          <TableCell className="text-right py-3">
                            <span className={`font-mono text-sm font-bold ${isPos ? "text-primary" : "text-destructive"}`}>
                              {fmtPrice(current)}
                            </span>
                          </TableCell>
                          {/* Highest */}
                          <TableCell className="text-right py-3">
                            <span className="text-muted-foreground font-mono text-sm">{fmtPrice(highest)}</span>
                          </TableCell>
                          {/* PnL % */}
                          <TableCell className="text-right py-3">
                            <span className={`font-black text-lg ${isPos ? "text-primary" : "text-destructive"}`}>
                              {isPos ? "+" : ""}{pnl.toFixed(2)}%
                            </span>
                          </TableCell>
                          {/* PnL SOL */}
                          <TableCell className="text-right py-3">
                            <span className={`font-semibold text-sm ${isPos ? "text-primary" : "text-destructive"}`}>
                              {isPos ? "+" : ""}{pnlSol.toFixed(4)}
                            </span>
                          </TableCell>
                          {/* SL/TP */}
                          <TableCell className="text-center py-3">
                            <div className="text-xs text-muted-foreground leading-relaxed">
                              <div>SL: <span className="text-foreground font-medium">{pos.trailing_stop_pct}%</span></div>
                              <div>TP: <span className="text-foreground font-medium">{pos.take_profit_pct}%</span></div>
                              {distToSL !== null && (
                                <div className={`text-[11px] mt-0.5 ${distToSL < 3 ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                                  ({distToSL.toFixed(1)}% do SL)
                                </div>
                              )}
                            </div>
                          </TableCell>
                          {/* Time */}
                          <TableCell className="text-right py-3">
                            <span className="text-sm text-muted-foreground">{timeAgo(pos.opened_at)}</span>
                          </TableCell>
                          {/* Action */}
                          <TableCell className="text-center py-3">
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-8 px-3 text-xs font-semibold"
                              disabled={closingId === pos.id}
                              onClick={() => {
                                if (confirm(`Zamknąć pozycję ${pos.token_symbol}?`)) {
                                  closePositionManually(pos);
                                }
                              }}
                            >
                              {closingId === pos.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <X className="h-3.5 w-3.5 mr-1" />
                              )}
                              Zamknij
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {/* Footer */}
              <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Razem: <span className="text-foreground font-bold">{openPositions.length}</span> pozycji
                </span>
                <span className={`text-base font-black ${totalPnlSol >= 0 ? "text-primary" : "text-destructive"}`}>
                  Σ PnL: {totalPnlSol >= 0 ? "+" : ""}{totalPnlSol.toFixed(4)} SOL
                </span>
              </div>
            </>
          )}
        </TabsContent>

        {/* ═══ CLOSED POSITIONS ═══ */}
        <TabsContent value="closed" className="mt-0">
          {closedPositions.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-base">
              Brak zamkniętych pozycji
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableHead className="text-xs font-bold uppercase tracking-wider">Token</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Wielkość</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Cena wejścia</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Cena wyjścia</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-right">PnL (%)</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-right">PnL (SOL)</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-center">Powód</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closedPositions.map((pos) => {
                    const pnl = Number(pos.pnl_pct) || 0;
                    const isPos = pnl >= 0;
                    const pnlSol = (pnl / 100) * Number(pos.amount_sol);
                    return (
                      <TableRow key={pos.id} className="hover:bg-muted/10">
                        <TableCell className="py-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full shrink-0 ${isPos ? "bg-primary" : "bg-destructive"}`} />
                            <span className="font-bold text-foreground text-sm">{pos.token_symbol || "???"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{Number(pos.amount_sol).toFixed(3)} SOL</TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">{fmtPrice(Number(pos.entry_price_usd))}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">{fmtPrice(Number(pos.current_price_usd))}</TableCell>
                        <TableCell className="text-right">
                          <span className={`font-bold text-base ${isPos ? "text-primary" : "text-destructive"}`}>
                            {isPos ? "+" : ""}{pnl.toFixed(2)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={`text-sm font-semibold ${isPos ? "text-primary" : "text-destructive"}`}>
                            {isPos ? "+" : ""}{pnlSol.toFixed(4)}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {(() => {
                            const reason = reasonLabels[pos.close_reason || ""];
                            return reason ? (
                              <span className={`text-xs font-bold px-2 py-1 rounded border ${reason.color} ${reason.bg}`}>
                                {reason.label}
                              </span>
                            ) : (
                              <Badge variant="secondary" className="text-xs px-2 py-0.5">
                                {pos.close_reason || "—"}
                              </Badge>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {pos.closed_at ? fmtTime(pos.closed_at) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ═══ TRADE HISTORY ═══ */}
        <TabsContent value="trades" className="mt-0">
          {tradeHistory.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-base">
              Brak historii transakcji
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableHead className="text-xs font-bold uppercase tracking-wider">Token</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-center">Kierunek</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Wielkość</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Cena</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Ilość</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-center">Status</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider">TX</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tradeHistory.map((tx) => {
                    const isBuy = tx.action === "BUY";
                    return (
                      <TableRow key={tx.id} className="hover:bg-muted/10">
                        <TableCell className="py-3">
                          <span className="font-bold text-foreground text-sm">{tx.token_symbol || tx.token_mint.slice(0, 8) + "..."}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={`text-xs px-2 py-0.5 font-semibold ${isBuy ? "text-primary border-primary/40" : "text-destructive border-destructive/40"}`}>
                            {isBuy ? "KUP" : "SPRZEDAJ"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{Number(tx.amount_sol).toFixed(3)} SOL</TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                          {tx.price_usd ? fmtPrice(Number(tx.price_usd)) : "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {tx.token_amount ? Number(tx.token_amount).toLocaleString("pl-PL", { maximumFractionDigits: 2 }) : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={tx.status === "completed" ? "default" : tx.status === "failed" ? "destructive" : "secondary"}
                            className="text-xs px-2 py-0.5"
                          >
                            {tx.status === "completed" ? "OK" : tx.status === "failed" ? "Błąd" : tx.status === "pending" ? "..." : tx.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground font-mono">
                            {tx.tx_signature ? tx.tx_signature.slice(0, 16) + "..." : tx.error_message?.slice(0, 20) || "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{fmtTime(tx.created_at)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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

const PNL_CAP_PCT = 500; // max 5x — powyżej to phantom liquidity

function capPnl(pnlPct: number): number {
  return Math.max(Math.min(pnlPct, PNL_CAP_PCT), -100);
}

function PnLSummary({ open, closed }: { open: Position[]; closed: Position[] }) {
  const totalClosedPnl = closed.reduce((s, p) => s + (capPnl(Number(p.pnl_pct) || 0) / 100) * Number(p.amount_sol), 0);
  const totalOpenPnl = open.reduce((s, p) => {
    const e = Number(p.entry_price_usd) || 0;
    const c = Number(p.current_price_usd) || 0;
    const rawPct = e > 0 ? ((c - e) / e) * 100 : 0;
    return s + (capPnl(rawPct) / 100) * Number(p.amount_sol);
  }, 0);

  const wins = closed.filter(p => capPnl(Number(p.pnl_pct) || 0) > 0).length;
  const losses = closed.filter(p => capPnl(Number(p.pnl_pct) || 0) < 0).length;
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
    <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((s, i) => (
        <div key={i} className="bg-muted/20 rounded-lg p-4 border border-border/50">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 font-medium">{s.label}</p>
          <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}
