import { useEffect, useState } from "react";
import { getHeliusApiKey } from "@/services/helius";
import { Wifi, WifiOff, Loader2, CheckCircle2, XCircle } from "lucide-react";

const BlockchainStatus = () => {
  const [status, setStatus] = useState<"connected" | "disconnected" | "checking">("checking");
  const [latency, setLatency] = useState<number | null>(null);
  const [blockHeight, setBlockHeight] = useState<number | null>(null);

  const checkConnection = async () => {
    const key = getHeliusApiKey();
    if (!key) {
      setStatus("disconnected");
      setLatency(null);
      setBlockHeight(null);
      return;
    }

    setStatus("checking");
    const start = performance.now();
    try {
      const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBlockHeight" }),
        signal: AbortSignal.timeout(5000),
      });
      const elapsed = Math.round(performance.now() - start);
      if (res.ok) {
        const json = await res.json();
        setStatus("connected");
        setLatency(elapsed);
        setBlockHeight(json.result || null);
      } else {
        setStatus("disconnected");
      }
    } catch {
      setStatus("disconnected");
      setLatency(null);
    }
  };

  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 60000);
    return () => clearInterval(interval);
  }, []);

  // Re-check when localStorage changes (key added/removed)
  useEffect(() => {
    const handler = () => checkConnection();
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return (
    <div className="neon-card rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${
          status === "connected" ? "bg-primary/10" :
          status === "disconnected" ? "bg-destructive/10" :
          "bg-neon-amber/10"
        }`}>
          {status === "connected" ? (
            <Wifi className="h-5 w-5 text-primary" />
          ) : status === "disconnected" ? (
            <WifiOff className="h-5 w-5 text-destructive" />
          ) : (
            <Loader2 className="h-5 w-5 text-neon-amber animate-spin" />
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              Solana Blockchain
            </span>
            {status === "connected" ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
            ) : status === "disconnected" ? (
              <XCircle className="h-3.5 w-3.5 text-destructive" />
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
            {status === "connected" ? (
              <>
                <span className="text-primary">● Połączono</span>
                {latency && <span>{latency}ms</span>}
                {blockHeight && <span>Blok #{blockHeight.toLocaleString()}</span>}
              </>
            ) : status === "disconnected" ? (
              <span className="text-destructive">● Brak połączenia — dodaj klucz API w Ustawieniach</span>
            ) : (
              <span className="text-neon-amber">Sprawdzanie...</span>
            )}
          </div>
        </div>
        <button
          onClick={checkConnection}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border hover:border-muted-foreground"
        >
          Odśwież
        </button>
      </div>
    </div>
  );
};

export default BlockchainStatus;
