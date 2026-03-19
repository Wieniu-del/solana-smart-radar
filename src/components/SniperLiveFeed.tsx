import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Crosshair, Zap, ShieldCheck, XCircle, TrendingUp, TrendingDown,
  Clock, Activity, Loader2, Trash2, Volume2, VolumeX, Eye
} from "lucide-react";

interface FeedEvent {
  id: string;
  timestamp: Date;
  type: "scan_start" | "scan_end" | "signal_new" | "signal_executed" | "signal_rejected" | "signal_expired" |
        "position_opened" | "position_closed" | "execution" | "error";
  title: string;
  detail?: string;
  color: string;
  icon: any;
}

const MAX_EVENTS = 150;

export default function SniperLiveFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const addEvent = (evt: Omit<FeedEvent, "id" | "timestamp">) => {
    const newEvt: FeedEvent = { ...evt, id: crypto.randomUUID(), timestamp: new Date() };
    setEvents(prev => {
      const next = [newEvt, ...prev];
      return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
    });
    // Sound ping for important events
    if (soundOn && (evt.type === "signal_executed" || evt.type === "position_opened" || evt.type === "position_closed")) {
      try { new Audio("data:audio/wav;base64,UklGRl9vT19teleAFgEBABEAIABkAGQAAQAIAGRhdGFbT19t").play().catch(() => {}); } catch {}
    }
  };

  // Load recent activity on mount
  useEffect(() => {
    async function loadRecent() {
      const since = new Date(Date.now() - 3600000).toISOString(); // last 1h

      const [runsRes, signalsRes, execsRes, posRes] = await Promise.all([
        supabase.from("bot_runs").select("*").gte("started_at", since).order("started_at", { ascending: false }).limit(10),
        supabase.from("trading_signals").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(30),
        supabase.from("trade_executions").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(20),
        supabase.from("open_positions").select("*").gte("updated_at", since).order("updated_at", { ascending: false }).limit(20),
      ]);

      const initial: FeedEvent[] = [];

      // Bot runs
      runsRes.data?.forEach(r => {
        if (r.status === "completed" || r.status === "error") {
          initial.push({
            id: r.id, timestamp: new Date(r.finished_at || r.started_at),
            type: r.status === "error" ? "error" : "scan_end",
            title: r.status === "error" ? `❌ Skan błąd` : `✅ Skan zakończony`,
            detail: r.status === "error"
              ? r.error_message?.slice(0, 80)
              : `${r.tokens_found || 0} tokenów · ${r.signals_generated || 0} sygnałów · ${r.duration_ms || 0}ms`,
            color: r.status === "error" ? "text-destructive" : "text-primary",
            icon: r.status === "error" ? XCircle : ShieldCheck,
          });
        }
      });

      // Signals
      signalsRes.data?.forEach(s => {
        const sym = s.token_symbol || s.token_mint.slice(0, 6);
        if (s.status === "executed") {
          initial.push({ id: s.id, timestamp: new Date(s.executed_at || s.created_at), type: "signal_executed", title: `⚡ Wykonano: ${sym}`, detail: `Score: ${s.confidence} · ${s.strategy}`, color: "text-primary", icon: Zap });
        } else if (s.status === "rejected") {
          initial.push({ id: s.id, timestamp: new Date(s.created_at), type: "signal_rejected", title: `🚫 Odrzucono: ${sym}`, detail: `Score: ${s.confidence} · ${s.strategy}`, color: "text-destructive", icon: XCircle });
        } else if (s.status === "pending") {
          initial.push({ id: s.id, timestamp: new Date(s.created_at), type: "signal_new", title: `🎯 Nowy sygnał: ${sym}`, detail: `Score: ${s.confidence} · ${s.strategy}`, color: "text-neon-amber", icon: Crosshair });
        }
      });

      // Executions
      execsRes.data?.forEach(e => {
        const sym = e.token_symbol || e.token_mint.slice(0, 6);
        initial.push({ id: e.id, timestamp: new Date(e.created_at), type: "execution", title: `${e.action === "BUY" ? "🟢" : "🔴"} ${e.action}: ${sym}`, detail: `${e.amount_sol} SOL · ${e.status}${e.price_usd ? ` · $${Number(e.price_usd).toFixed(6)}` : ""}`, color: e.action === "BUY" ? "text-primary" : "text-destructive", icon: e.action === "BUY" ? TrendingUp : TrendingDown });
      });

      // Closed positions
      posRes.data?.filter(p => p.status === "closed").forEach(p => {
        const sym = p.token_symbol || p.token_mint.slice(0, 6);
        const pnl = Number(p.pnl_pct || 0);
        initial.push({ id: p.id + "_close", timestamp: new Date(p.closed_at || p.updated_at), type: "position_closed", title: `${pnl >= 0 ? "💰" : "💸"} Zamknięto: ${sym}`, detail: `PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}% · ${p.close_reason || "manual"} · ${p.amount_sol} SOL`, color: pnl >= 0 ? "text-primary" : "text-destructive", icon: pnl >= 0 ? TrendingUp : TrendingDown });
      });

      initial.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      setEvents(initial.slice(0, MAX_EVENTS));
    }
    loadRecent();
  }, []);

  // Realtime subscriptions
  useEffect(() => {
    const channel = supabase.channel("sniper-live-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bot_runs" }, (payload) => {
        addEvent({ type: "scan_start", title: "🔍 Skan rozpoczęty", detail: "Sniper skanuje rynek...", color: "text-muted-foreground", icon: Activity });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bot_runs" }, (payload) => {
        const r = payload.new as any;
        if (r.status === "completed") {
          addEvent({ type: "scan_end", title: "✅ Skan zakończony", detail: `${r.tokens_found || 0} tokenów · ${r.signals_generated || 0} sygnałów · ${r.duration_ms || 0}ms`, color: "text-primary", icon: ShieldCheck });
        } else if (r.status === "error") {
          addEvent({ type: "error", title: "❌ Błąd skanu", detail: r.error_message?.slice(0, 80), color: "text-destructive", icon: XCircle });
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trading_signals" }, (payload) => {
        const s = payload.new as any;
        const sym = s.token_symbol || s.token_mint?.slice(0, 6) || "???";
        addEvent({ type: "signal_new", title: `🎯 Nowy sygnał: ${sym}`, detail: `Score: ${s.confidence} · ${s.strategy} · ${s.signal_type}`, color: "text-neon-amber", icon: Crosshair });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trading_signals" }, (payload) => {
        const s = payload.new as any;
        const sym = s.token_symbol || s.token_mint?.slice(0, 6) || "???";
        if (s.status === "executed") {
          addEvent({ type: "signal_executed", title: `⚡ Wykonano: ${sym}`, detail: `Score: ${s.confidence} · ${s.strategy}`, color: "text-primary", icon: Zap });
        } else if (s.status === "rejected") {
          addEvent({ type: "signal_rejected", title: `🚫 Odrzucono: ${sym}`, detail: `Score: ${s.confidence} · ${s.strategy}`, color: "text-destructive", icon: XCircle });
        } else if (s.status === "expired") {
          addEvent({ type: "signal_expired", title: `⏰ Wygasł: ${sym}`, detail: `Score: ${s.confidence}`, color: "text-muted-foreground", icon: Clock });
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trade_executions" }, (payload) => {
        const e = payload.new as any;
        const sym = e.token_symbol || e.token_mint?.slice(0, 6) || "???";
        addEvent({ type: "execution", title: `${e.action === "BUY" ? "🟢 KUPIONO" : "🔴 SPRZEDANO"}: ${sym}`, detail: `${e.amount_sol} SOL · $${Number(e.price_usd || 0).toFixed(6)} · ${e.status}`, color: e.action === "BUY" ? "text-primary" : "text-destructive", icon: e.action === "BUY" ? TrendingUp : TrendingDown });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "open_positions" }, (payload) => {
        const p = payload.new as any;
        const sym = p.token_symbol || p.token_mint?.slice(0, 6) || "???";
        addEvent({ type: "position_opened", title: `📈 Pozycja otwarta: ${sym}`, detail: `${p.amount_sol} SOL · Entry: $${Number(p.entry_price_usd).toFixed(6)}`, color: "text-primary", icon: TrendingUp });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "open_positions" }, (payload) => {
        const p = payload.new as any;
        if (p.status === "closed") {
          const sym = p.token_symbol || p.token_mint?.slice(0, 6) || "???";
          const pnl = Number(p.pnl_pct || 0);
          addEvent({ type: "position_closed", title: `${pnl >= 0 ? "💰" : "💸"} Zamknięto: ${sym}`, detail: `PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}% · ${p.close_reason || "manual"} · ${p.amount_sol} SOL`, color: pnl >= 0 ? "text-primary" : "text-destructive", icon: pnl >= 0 ? TrendingUp : TrendingDown });
        }
      })
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => { supabase.removeChannel(channel); };
  }, [soundOn]);

  const clearEvents = () => setEvents([]);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            Sniper Live Feed
            {connected ? (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
              </span>
            ) : (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-[9px]">{events.length} zdarzeń</Badge>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setSoundOn(!soundOn)} title={soundOn ? "Wycisz" : "Włącz dźwięk"}>
              {soundOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={clearEvents} title="Wyczyść">
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[420px]" ref={scrollRef}>
          <div className="space-y-0.5 p-3 pt-1">
            {events.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Crosshair className="h-10 w-10 mx-auto mb-2 opacity-20" />
                <p className="text-xs">Sniper nasłuchuje...</p>
                <p className="text-[10px] mt-1">Zdarzenia pojawią się tutaj w czasie rzeczywistym</p>
              </div>
            ) : (
              events.map((evt) => {
                const Icon = evt.icon;
                return (
                  <div key={evt.id} className="flex items-start gap-2.5 py-1.5 px-2 rounded-md hover:bg-muted/30 transition-colors group">
                    <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${evt.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${evt.color}`}>{evt.title}</span>
                        <span className="text-[9px] text-muted-foreground ml-auto shrink-0">
                          {evt.timestamp.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                      </div>
                      {evt.detail && <p className="text-[10px] text-muted-foreground truncate">{evt.detail}</p>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
