import { useEffect, useState, useCallback } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { getHeliusApiKey } from "@/services/helius";
import { Wifi, WifiOff, Loader2, LogOut, User } from "lucide-react";
import NotificationCenter from "@/components/NotificationCenter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

const TopBar = () => {
  const { user, signOut } = useAuth();
  const [chainStatus, setChainStatus] = useState<"online" | "offline" | "checking">("checking");
  const [currentTime, setCurrentTime] = useState(new Date());
  const [latency, setLatency] = useState<number | null>(null);

  const checkChain = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    checkChain();
    const healthInterval = setInterval(checkChain, 30000);
    const clockInterval = setInterval(() => setCurrentTime(new Date()), 1000);

    // Re-check when Helius key is updated (from init or settings)
    const onKeyUpdate = () => { checkChain(); };
    window.addEventListener("helius-key-updated", onKeyUpdate);
    window.addEventListener("storage", onKeyUpdate);

    return () => {
      clearInterval(healthInterval);
      clearInterval(clockInterval);
      window.removeEventListener("helius-key-updated", onKeyUpdate);
      window.removeEventListener("storage", onKeyUpdate);
    };
  }, [checkChain]);

  return (
    <header className="h-12 flex items-center justify-between border-b border-border px-4 bg-card/50 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
        <div className="h-4 w-px bg-border" />
        <span className="text-xs font-mono text-muted-foreground">
          Smart Money Radar
        </span>
      </div>

      <div className="flex items-center gap-3">
        <NotificationCenter />
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

        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-2">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-mono text-muted-foreground hidden sm:inline truncate max-w-[120px]">
            {user?.email}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={signOut}
            title="Wyloguj"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </header>
  );
};

export default TopBar;
