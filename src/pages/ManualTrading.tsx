import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  HandCoins, TrendingUp, TrendingDown, ArrowRightLeft, Settings2,
  DollarSign, Percent, Shield, Loader2
} from "lucide-react";

interface ManualOrder {
  id: string;
  type: "BUY" | "SELL";
  tokenMint: string;
  tokenSymbol: string;
  amountSol: number;
  slippage: number;
  stopLoss: number | null;
  takeProfit: number | null;
  status: "pending" | "executed" | "failed";
  createdAt: string;
}

export default function ManualTrading() {
  const [orderType, setOrderType] = useState<"BUY" | "SELL">("BUY");
  const [tokenMint, setTokenMint] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [amountSol, setAmountSol] = useState("0.1");
  const [slippage, setSlippage] = useState("1");
  const [stopLoss, setStopLoss] = useState("20");
  const [takeProfit, setTakeProfit] = useState("50");
  const [submitting, setSubmitting] = useState(false);
  const [orders, setOrders] = useState<ManualOrder[]>(() => {
    try { return JSON.parse(localStorage.getItem("manual_orders") || "[]"); } catch { return []; }
  });

  const handleSubmit = async () => {
    if (!tokenMint.trim()) {
      toast.error("Podaj adres tokena (mint)");
      return;
    }
    if (parseFloat(amountSol) <= 0) {
      toast.error("Kwota musi być większa od 0");
      return;
    }

    setSubmitting(true);

    const order: ManualOrder = {
      id: crypto.randomUUID(),
      type: orderType,
      tokenMint: tokenMint.trim(),
      tokenSymbol: tokenSymbol.trim() || "???",
      amountSol: parseFloat(amountSol),
      slippage: parseFloat(slippage),
      stopLoss: stopLoss ? parseFloat(stopLoss) : null,
      takeProfit: takeProfit ? parseFloat(takeProfit) : null,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    // Save locally (no edge function execution yet)
    const updated = [order, ...orders];
    setOrders(updated);
    localStorage.setItem("manual_orders", JSON.stringify(updated));

    toast.success(`Zlecenie ${orderType} dodane — oczekuje na wykonanie`);
    setSubmitting(false);
    setTokenMint("");
    setTokenSymbol("");
  };

  const clearOrders = () => {
    setOrders([]);
    localStorage.setItem("manual_orders", "[]");
    toast.success("Historia zleceń wyczyszczona");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <HandCoins className="h-8 w-8 text-secondary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Handel Ręczny</h1>
          <p className="text-sm text-muted-foreground">Twórz ręczne zlecenia kupna i sprzedaży tokenów</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Order Form */}
        <Card className="border-border bg-card">
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center gap-2 mb-2">
              <Settings2 className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-foreground">Nowe zlecenie</h2>
            </div>

            {/* Buy/Sell toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => setOrderType("BUY")}
                className={`flex-1 py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all ${
                  orderType === "BUY"
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "bg-muted text-muted-foreground border border-border hover:border-muted-foreground"
                }`}
              >
                <TrendingUp className="h-4 w-4" />
                KUP
              </button>
              <button
                onClick={() => setOrderType("SELL")}
                className={`flex-1 py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all ${
                  orderType === "SELL"
                    ? "bg-destructive/20 text-destructive border border-destructive/30"
                    : "bg-muted text-muted-foreground border border-border hover:border-muted-foreground"
                }`}
              >
                <TrendingDown className="h-4 w-4" />
                SPRZEDAJ
              </button>
            </div>

            {/* Token */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Adres tokena (mint)</label>
              <input
                value={tokenMint}
                onChange={(e) => setTokenMint(e.target.value)}
                placeholder="np. So11111111111111111111111111111111111111112"
                className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Symbol tokena</label>
              <input
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value)}
                placeholder="np. SOL, BONK, JUP..."
                className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Amount */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Kwota (SOL)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amountSol}
                  onChange={(e) => setAmountSol(e.target.value)}
                  className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <Percent className="h-3 w-3" /> Slippage (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            {/* SL / TP */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <Shield className="h-3 w-3" /> Stop Loss (%)
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Take Profit (%)
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                  className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className={`w-full h-12 text-base font-bold ${
                orderType === "BUY"
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              }`}
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <ArrowRightLeft className="h-5 w-5 mr-2" />
                  {orderType === "BUY" ? "Złóż zlecenie kupna" : "Złóż zlecenie sprzedaży"}
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Orders History */}
        <Card className="border-border bg-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-foreground flex items-center gap-2">
                <ArrowRightLeft className="h-5 w-5 text-secondary" />
                Historia zleceń
              </h2>
              {orders.length > 0 && (
                <button onClick={clearOrders} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
                  Wyczyść
                </button>
              )}
            </div>

            {orders.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <HandCoins className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Brak zleceń</p>
                <p className="text-xs mt-1">Utwórz pierwsze zlecenie ręczne</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {orders.map((order) => (
                  <div key={order.id} className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2.5">
                    <div className={`p-1.5 rounded ${order.type === "BUY" ? "bg-primary/10" : "bg-destructive/10"}`}>
                      {order.type === "BUY" ? (
                        <TrendingUp className="h-4 w-4 text-primary" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-destructive" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{order.type} {order.tokenSymbol}</span>
                        <Badge variant="outline" className="text-[10px]">{order.amountSol} SOL</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">{order.tokenMint}</p>
                      <p className="text-[10px] text-muted-foreground">
                        SL: {order.stopLoss || "-"}% · TP: {order.takeProfit || "-"}% · Slip: {order.slippage}%
                      </p>
                    </div>
                    <Badge className={
                      order.status === "executed" ? "bg-primary/10 text-primary border-primary/30" :
                      order.status === "failed" ? "bg-destructive/10 text-destructive border-destructive/30" :
                      "bg-neon-amber/10 text-neon-amber border-neon-amber/30"
                    }>
                      {order.status === "pending" ? "Oczekuje" : order.status === "executed" ? "Wykonano" : "Błąd"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
