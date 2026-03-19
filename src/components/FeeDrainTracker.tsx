import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Flame, TrendingDown, ArrowRight } from "lucide-react";
import LivePulse from "./LivePulse";

const TX_FEE_SOL = 0.005; // priority fee + base per swap tx
const SLIPPAGE_PCT = 0.5; // avg slippage cost per swap (%)

const FeeDrainTracker = () => {
  const [data, setData] = useState<{
    totalFeeSol: number;
    txCount: number;
    slippageSol: number;
    priorityFeeSol: number;
    avgFeePerTrade: number;
    feeAsPctOfVolume: number;
  } | null>(null);

  useEffect(() => {
    loadFees();
    const interval = setInterval(loadFees, 60_000);
    return () => clearInterval(interval);
  }, []);

  const loadFees = async () => {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: positions } = await supabase
        .from("open_positions")
        .select("amount_sol, status, closed_at, opened_at")
        .or(`opened_at.gte.${sevenDaysAgo.toISOString()},closed_at.gte.${sevenDaysAgo.toISOString()}`);

      if (!positions) return;

      // Count transactions: each position = 1 buy tx, closed positions = +1 sell tx
      const buys = positions.length;
      const sells = positions.filter(p => p.status === "closed").length;
      const txCount = buys + sells;

      // Priority/base fees
      const priorityFeeSol = txCount * TX_FEE_SOL;

      // Slippage cost estimate (based on position sizes)
      const totalVolumeSol = positions.reduce((sum, p) => {
        const buyVol = p.amount_sol;
        const sellVol = p.status === "closed" ? p.amount_sol : 0;
        return sum + buyVol + sellVol;
      }, 0);
      const slippageSol = totalVolumeSol * (SLIPPAGE_PCT / 100);

      const totalFeeSol = priorityFeeSol + slippageSol;
      const avgFeePerTrade = positions.length > 0 ? totalFeeSol / positions.length : 0;
      const feeAsPctOfVolume = totalVolumeSol > 0 ? (totalFeeSol / totalVolumeSol) * 100 : 0;

      setData({
        totalFeeSol,
        txCount,
        slippageSol,
        priorityFeeSol,
        avgFeePerTrade,
        feeAsPctOfVolume,
      });
    } catch (e) {
      console.warn("Fee tracker error:", e);
    }
  };

  if (!data) {
    return (
      <div className="neon-card rounded-xl p-4 animate-pulse">
        <div className="h-5 w-32 bg-muted/50 rounded mb-3" />
        <div className="h-8 w-24 bg-muted/30 rounded" />
      </div>
    );
  }

  return (
    <div className="neon-card rounded-xl p-4 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10 blur-3xl pointer-events-none bg-destructive" />

      <div className="flex items-center gap-2 mb-3">
        <Flame className="h-4 w-4 text-destructive animate-pulse" />
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Fee Drain (7 dni)
        </h3>
        <LivePulse color="bg-destructive" />
      </div>

      {/* Main number */}
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-2xl font-black font-mono text-destructive">
          -{data.totalFeeSol.toFixed(4)}
        </span>
        <span className="text-xs text-muted-foreground">SOL</span>
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="bg-muted/20 border border-border rounded-lg p-2">
          <p className="text-[10px] text-muted-foreground uppercase">TX Fees</p>
          <p className="text-xs font-bold font-mono text-foreground">
            {data.priorityFeeSol.toFixed(4)} SOL
          </p>
          <p className="text-[9px] text-muted-foreground">{data.txCount} transakcji</p>
        </div>
        <div className="bg-muted/20 border border-border rounded-lg p-2">
          <p className="text-[10px] text-muted-foreground uppercase">Slippage</p>
          <p className="text-xs font-bold font-mono text-foreground">
            ~{data.slippageSol.toFixed(4)} SOL
          </p>
          <p className="text-[9px] text-muted-foreground">~{SLIPPAGE_PCT}% avg</p>
        </div>
      </div>

      {/* Bottom stats */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-border pt-2">
        <span className="flex items-center gap-1">
          <TrendingDown className="h-3 w-3" />
          Avg/trade: {data.avgFeePerTrade.toFixed(4)} SOL
        </span>
        <span>{data.feeAsPctOfVolume.toFixed(1)}% wolumenu</span>
      </div>
    </div>
  );
};

export default FeeDrainTracker;
