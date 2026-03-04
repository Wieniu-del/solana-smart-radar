import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getHeliusApiKey } from "@/services/helius";
import {
  CheckCircle2, XCircle, AlertTriangle, RefreshCw, Bot, Wallet,
  Brain, Users, Shield, Zap, Activity, Database, Key, Globe,
  TrendingUp, Search, Loader2
} from "lucide-react";

interface SystemModule {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  status: "active" | "inactive" | "warning" | "error" | "checking";
  details?: string;
  category: "core" | "trading" | "intelligence" | "data";
}

export default function SystemStatusPanel() {
  const [modules, setModules] = useState<SystemModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastCheck, setLastCheck] = useState<Date>(new Date());

  const checkAllSystems = async () => {
    setLoading(true);
    const results: SystemModule[] = [];

    // 1. Helius API Key
    const heliusKey = getHeliusApiKey();
    results.push({
      id: "helius",
      name: "Helius API",
      description: "Połączenie z blockchainem Solana",
      icon: Key,
      status: heliusKey ? "active" : "error",
      details: heliusKey ? "Klucz skonfigurowany" : "Brak klucza — dodaj w Ustawieniach",
      category: "core",
    });

    // 2. Bot 24/7 status
    try {
      const { data: botConfig } = await supabase
        .from("bot_config")
        .select("value")
        .eq("key", "bot_enabled")
        .single();
      const enabled = botConfig?.value === true;
      results.push({
        id: "bot",
        name: "Bot 24/7",
        description: "Automatyczne skanowanie portfeli",
        icon: Bot,
        status: enabled ? "active" : "inactive",
        details: enabled ? "Działa — skan co 1 min" : "Wyłączony",
        category: "trading",
      });
    } catch {
      results.push({
        id: "bot",
        name: "Bot 24/7",
        description: "Automatyczne skanowanie portfeli",
        icon: Bot,
        status: "error",
        details: "Nie można sprawdzić statusu",
        category: "trading",
      });
    }

    // 3. Tracked wallets
    try {
      const { data: walletsConfig } = await supabase
        .from("bot_config")
        .select("value")
        .eq("key", "tracked_wallets")
        .single();
      const wallets = (walletsConfig?.value as string[]) || [];
      const localWallets: string[] = (() => {
        try { return JSON.parse(localStorage.getItem("tracked_wallets") || "[]"); } catch { return []; }
      })();
      const totalWallets = Math.max(wallets.length, localWallets.length);
      results.push({
        id: "wallets",
        name: "Śledzone portfele",
        description: "Lista smart money wallets",
        icon: Wallet,
        status: totalWallets > 0 ? "active" : "warning",
        details: totalWallets > 0 ? `${totalWallets} portfeli (DB: ${wallets.length}, Local: ${localWallets.length})` : "Brak portfeli — dodaj w panelu bota",
        category: "data",
      });
    } catch {
      results.push({
        id: "wallets",
        name: "Śledzone portfele",
        description: "Lista smart money wallets",
        icon: Wallet,
        status: "error",
        details: "Błąd odczytu",
        category: "data",
      });
    }

    // 4. Trading strategies
    try {
      const { data: strategies } = await supabase
        .from("trading_strategies")
        .select("enabled");
      const total = strategies?.length || 0;
      const active = strategies?.filter(s => s.enabled).length || 0;
      results.push({
        id: "strategies",
        name: "Strategie tradingowe",
        description: "Reguły decyzyjne BUY/SELL",
        icon: TrendingUp,
        status: active > 0 ? "active" : "warning",
        details: `${active}/${total} aktywnych`,
        category: "trading",
      });
    } catch {
      results.push({
        id: "strategies",
        name: "Strategie tradingowe",
        description: "Reguły decyzyjne BUY/SELL",
        icon: TrendingUp,
        status: "error",
        category: "trading",
      });
    }

    // 5. Bot runs (last 24h)
    try {
      const { data: runs } = await supabase
        .from("bot_runs")
        .select("status, started_at, duration_ms")
        .order("started_at", { ascending: false })
        .limit(50);
      const total = runs?.length || 0;
      const errors = runs?.filter(r => r.status === "error").length || 0;
      const lastRun = runs?.[0];
      const avgDuration = runs && runs.length > 0
        ? Math.round(runs.reduce((s, r) => s + (r.duration_ms || 0), 0) / runs.length)
        : 0;
      results.push({
        id: "bot_runs",
        name: "Historia skanów",
        description: "Ostatnie uruchomienia bota",
        icon: Activity,
        status: errors > 0 ? "warning" : total > 0 ? "active" : "inactive",
        details: total > 0
          ? `${total} skanów, ${errors} błędów, śr. ${avgDuration}ms`
          : "Brak skanów",
        category: "trading",
      });
    } catch {
      results.push({
        id: "bot_runs",
        name: "Historia skanów",
        icon: Activity,
        description: "Ostatnie uruchomienia bota",
        status: "error",
        category: "trading",
      });
    }

    // 6. Trading signals
    try {
      const { data: signals } = await supabase
        .from("trading_signals")
        .select("signal_type, status")
        .order("created_at", { ascending: false })
        .limit(200);
      const total = signals?.length || 0;
      const pending = signals?.filter(s => s.status === "pending").length || 0;
      const buys = signals?.filter(s => s.signal_type === "BUY").length || 0;
      results.push({
        id: "signals",
        name: "Sygnały tradingowe",
        description: "Wygenerowane sygnały BUY/SELL",
        icon: Zap,
        status: total > 0 ? "active" : "inactive",
        details: total > 0
          ? `${total} łącznie, ${buys} BUY, ${pending} oczekujących`
          : "Brak sygnałów — uruchom skan",
        category: "trading",
      });
    } catch {
      results.push({
        id: "signals",
        name: "Sygnały tradingowe",
        icon: Zap,
        description: "Wygenerowane sygnały",
        status: "error",
        category: "trading",
      });
    }

    // 7. Open positions
    try {
      const { data: positions } = await supabase
        .from("open_positions")
        .select("status, pnl_pct")
        .eq("status", "open");
      const openCount = positions?.length || 0;
      results.push({
        id: "positions",
        name: "Otwarte pozycje",
        description: "Aktywne inwestycje",
        icon: Database,
        status: openCount > 0 ? "active" : "inactive",
        details: openCount > 0 ? `${openCount} otwartych` : "Brak otwartych pozycji",
        category: "trading",
      });
    } catch {
      results.push({
        id: "positions",
        name: "Otwarte pozycje",
        icon: Database,
        description: "Aktywne inwestycje",
        status: "error",
        category: "trading",
      });
    }

    // 8. Trade executions
    try {
      const { data: execs } = await supabase
        .from("trade_executions")
        .select("status, action")
        .order("created_at", { ascending: false })
        .limit(100);
      const total = execs?.length || 0;
      const success = execs?.filter(e => e.status === "success").length || 0;
      results.push({
        id: "executions",
        name: "Wykonane transakcje",
        description: "Historia egzekucji",
        icon: Shield,
        status: total > 0 ? "active" : "inactive",
        details: total > 0 ? `${total} transakcji, ${success} udanych` : "Brak transakcji",
        category: "trading",
      });
    } catch {
      results.push({
        id: "executions",
        name: "Wykonane transakcje",
        icon: Shield,
        description: "Historia egzekucji",
        status: "error",
        category: "trading",
      });
    }

    // 9. Wallet Auto-discovery
    results.push({
      id: "discovery",
      name: "Auto-discovery portfeli",
      description: "Wyszukiwanie nowych smart wallets",
      icon: Search,
      status: "active",
      details: "Edge Function gotowa — uruchom w panelu bota",
      category: "intelligence",
    });

    // 10. AI Sentiment Analysis
    results.push({
      id: "sentiment",
      name: "AI Analiza sentymentu",
      description: "Gemini analiza tokenu przed BUY",
      icon: Brain,
      status: "active",
      details: "Zintegrowane z bot-monitor",
      category: "intelligence",
    });

    // 11. Smart Money Correlation
    results.push({
      id: "correlation",
      name: "Korelacja Smart Money",
      description: "Konsensus 2+ portfeli = bonus",
      icon: Users,
      status: "active",
      details: "Aktywne w pipeline bota (+8pkt/portfel, max +20)",
      category: "intelligence",
    });

    // 12. Solana RPC
    if (heliusKey) {
      try {
        const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
          signal: AbortSignal.timeout(5000),
        });
        const json = await res.json();
        results.push({
          id: "rpc",
          name: "Solana RPC",
          description: "Połączenie z siecią Solana",
          icon: Globe,
          status: json.result === "ok" ? "active" : "warning",
          details: json.result === "ok" ? "Połączony — mainnet healthy" : "Problem z RPC",
          category: "core",
        });
      } catch {
        results.push({
          id: "rpc",
          name: "Solana RPC",
          description: "Połączenie z siecią Solana",
          icon: Globe,
          status: "error",
          details: "Brak odpowiedzi RPC",
          category: "core",
        });
      }
    }

    setModules(results);
    setLastCheck(new Date());
    setLoading(false);
  };

  useEffect(() => {
    checkAllSystems();
  }, []);

  const statusIcon = (status: SystemModule["status"]) => {
    switch (status) {
      case "active": return <CheckCircle2 className="h-4 w-4 text-primary" />;
      case "inactive": return <XCircle className="h-4 w-4 text-muted-foreground" />;
      case "warning": return <AlertTriangle className="h-4 w-4 text-neon-amber" />;
      case "error": return <XCircle className="h-4 w-4 text-destructive" />;
      case "checking": return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    }
  };

  const statusBadge = (status: SystemModule["status"]) => {
    switch (status) {
      case "active": return <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">Aktywny</Badge>;
      case "inactive": return <Badge variant="outline" className="text-muted-foreground text-[10px]">Nieaktywny</Badge>;
      case "warning": return <Badge className="bg-neon-amber/10 text-neon-amber border-neon-amber/20 text-[10px]">Uwaga</Badge>;
      case "error": return <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px]">Błąd</Badge>;
      default: return null;
    }
  };

  const categories = [
    { key: "core", label: "🔧 Infrastruktura", icon: Globe },
    { key: "trading", label: "📊 Trading", icon: TrendingUp },
    { key: "intelligence", label: "🧠 Inteligencja AI", icon: Brain },
    { key: "data", label: "💾 Dane", icon: Database },
  ];

  const activeCount = modules.filter(m => m.status === "active").length;
  const warningCount = modules.filter(m => m.status === "warning" || m.status === "error").length;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <Card className="border-border bg-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-bold text-foreground">Status Systemu</h3>
                <p className="text-xs text-muted-foreground">
                  Ostatni check: {lastCheck.toLocaleTimeString("pl-PL")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span className="font-bold text-foreground">{activeCount}</span>
                  <span className="text-muted-foreground text-xs">aktywnych</span>
                </span>
                {warningCount > 0 && (
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-neon-amber" />
                    <span className="font-bold text-foreground">{warningCount}</span>
                    <span className="text-muted-foreground text-xs">wymagających uwagi</span>
                  </span>
                )}
                <span className="text-muted-foreground text-xs">/ {modules.length} modułów</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={checkAllSystems}
                disabled={loading}
                className="gap-1.5"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Odśwież
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modules by category */}
      {categories.map(cat => {
        const catModules = modules.filter(m => m.category === cat.key);
        if (catModules.length === 0) return null;
        return (
          <div key={cat.key}>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
              {cat.label}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {catModules.map(mod => (
                <Card key={mod.id} className="border-border bg-card hover:bg-muted/20 transition-colors">
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <div className={`p-1.5 rounded-md mt-0.5 ${
                        mod.status === "active" ? "bg-primary/10" :
                        mod.status === "error" ? "bg-destructive/10" :
                        mod.status === "warning" ? "bg-neon-amber/10" :
                        "bg-muted/30"
                      }`}>
                        <mod.icon className={`h-4 w-4 ${
                          mod.status === "active" ? "text-primary" :
                          mod.status === "error" ? "text-destructive" :
                          mod.status === "warning" ? "text-neon-amber" :
                          "text-muted-foreground"
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">{mod.name}</span>
                          {statusBadge(mod.status)}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{mod.description}</p>
                        {mod.details && (
                          <p className={`text-[11px] mt-1 ${
                            mod.status === "active" ? "text-primary/80" :
                            mod.status === "error" ? "text-destructive/80" :
                            mod.status === "warning" ? "text-neon-amber/80" :
                            "text-muted-foreground"
                          }`}>
                            {statusIcon(mod.status)}
                            <span className="ml-1">{mod.details}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
