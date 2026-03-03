import { useEffect, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { getHeliusApiKey } from "@/services/helius";
import { Wifi, WifiOff, Loader2 } from "lucide-react";

const TopBar = () => {
  const [chainStatus, setChainStatus] = useState<"online" | "offline" | "checking">("checking");
  const [currentTime, setCurrentTime] = useState(new Date());
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    const checkChain = async () => {
      const key = getHeliusApiKey();
      if (!key) {
        setChainStatus("offline");
        setLatency(null);
        return;
      }
      const start = performance.now();
      try {
        const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
          signal: AbortSignal.timeout(5000),
        });
        setLatency(Math.round(performance.now() - start));
        setChainStatus(res.ok ? "online" : "offline");
      } catch {
        setChainStatus("offline");
        setLatency(null);
      }
    };

    checkChain();
    const healthInterval = setInterval(checkChain, 30000);
    const clockInterval = setInterval(() => setCurrentTime(new Date()), 1000);

    return () => {
      clearInterval(healthInterval);
      clearInterval(clockInterval);
    };
  }, []);

  return (
    <header className="h-12 flex items-center justify-between border-b border-border px-4 bg-card/50 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
        <div className="h-4 w-px bg-border" />
        <span className="text-xs font-mono text-muted-foreground">
          Smart Money Radar
        </span>
      </div>

      <div className="flex items-center gap-4">
        {/* Blockchain Status */}
        <div className="flex items-center gap-2 text-xs font-mono">
          {chainStatus === "checking" ? (
            <Loader2 className="h-3 w-3 text-neon-amber animate-spin" />
          ) : chainStatus === "online" ? (
            <Wifi className="h-3 w-3 text-primary" />
          ) : (
            <WifiOff className="h-3 w-3 text-destructive" />
          )}
          <div className={`w-2 h-2 rounded-full ${
            chainStatus === "online" ? "bg-primary pulse-neon" :
            chainStatus === "offline" ? "bg-destructive" :
            "bg-neon-amber animate-pulse"
          }`} />
          <span className="text-muted-foreground hidden sm:inline">
            {chainStatus === "online"
              ? `Solana ${latency ? `(${latency}ms)` : ""}`
              : chainStatus === "offline"
              ? "Offline"
              : "..."}
          </span>
        </div>

        {/* Network */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-muted-foreground hidden sm:inline">Mainnet</span>
        </div>

        {/* Timestamp */}
        <span className="text-xs font-mono text-muted-foreground hidden md:inline">
          {currentTime.toLocaleTimeString("en-US", { hour12: false })}
        </span>
      </div>
    </header>
  );
};

export default TopBar;
