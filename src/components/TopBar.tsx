import { useEffect, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";

const TopBar = () => {
  const [apiStatus, setApiStatus] = useState<"online" | "offline" | "checking">("checking");
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    // Check API health
    const checkHealth = async () => {
      try {
        const res = await fetch("/api/health", { signal: AbortSignal.timeout(3000) });
        setApiStatus(res.ok ? "online" : "offline");
      } catch {
        setApiStatus("offline");
      }
    };
    checkHealth();
    const healthInterval = setInterval(checkHealth, 30000);

    // Update clock
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
        {/* API Status */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <div className={`w-2 h-2 rounded-full ${
            apiStatus === "online" ? "bg-primary pulse-neon" :
            apiStatus === "offline" ? "bg-destructive" :
            "bg-neon-amber animate-pulse"
          }`} />
          <span className="text-muted-foreground hidden sm:inline">
            API {apiStatus === "online" ? "Online" : apiStatus === "offline" ? "Offline" : "..."}
          </span>
        </div>

        {/* Network */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <div className="w-2 h-2 rounded-full bg-primary pulse-neon" />
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
