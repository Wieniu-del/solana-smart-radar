import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { STRATEGY_META, type Strategy } from "@/services/bot/types";
import { config } from "@/services/bot/config";
import {
  TrendingUp, Activity, BarChart3, Zap, AlertTriangle,
  Shield, Clock, ChevronDown, ChevronUp
} from "lucide-react";

const riskColors = {
  low: "bg-primary/10 text-primary border-primary/30",
  medium: "bg-neon-amber/10 text-neon-amber border-neon-amber/30",
  high: "bg-destructive/10 text-destructive border-destructive/30",
};

const riskLabels = { low: "Niskie", medium: "Średnie", high: "Wysokie" };

const configDetails: Record<Strategy, Record<string, number | number[]>> = {
  volume_explosion: {
    "EMA krótka": config.volumeExplosion.emaShort,
    "EMA długa": config.volumeExplosion.emaLong,
    "Mnożnik wolumenu": config.volumeExplosion.volumeMultiplier,
    "RSI próg": config.volumeExplosion.rsiThreshold,
    "Max wiek (min)": config.volumeExplosion.maxAgeMinutes,
  },
  rsi_divergence: {
    "RSI okres": config.rsiDivergence.rsiPeriod,
    "Mnożnik wolumenu": config.rsiDivergence.volumeMultiplier,
    "RSI wyprzedanie": config.rsiDivergence.rsiOversold,
  },
  ema_ribbon: {
    "Wstęga EMA": config.emaRibbon.ribbon,
    "Mnożnik wolumenu": config.emaRibbon.volumeMultiplier,
    "RSI minimum": config.emaRibbon.rsiMin,
  },
  vwap_reversion: {
    "Mnożnik wolumenu": config.vwapReversion.volumeMultiplier,
    "RSI max": config.vwapReversion.rsiMax,
    "Min wiek (min)": config.vwapReversion.minAge,
  },
  triple_momentum: {
    "EMA krótka": config.tripleMomentum.emaShort,
    "EMA długa": config.tripleMomentum.emaLong,
    "EMA trend": config.tripleMomentum.emaTrend,
    "RSI próg": config.tripleMomentum.rsiBuy,
    "Mnożnik wolumenu": config.tripleMomentum.volumeMultiplier,
    "Max wiek (min)": config.tripleMomentum.maxAgeMinutes,
  },
};

export default function TechnicalStrategiesPanel() {
  const [enabledStrategies, setEnabledStrategies] = useState<Strategy[]>([]);
  const [expandedStrategy, setExpandedStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadEnabledStrategies();
  }, []);

  async function loadEnabledStrategies() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("bot_config")
        .select("value")
        .eq("key", "technical_strategies")
        .maybeSingle();
      
      const stored = (data?.value as Strategy[]) || [];
      setEnabledStrategies(stored);
    } catch {
      // defaults
    } finally {
      setLoading(false);
    }
  }

  async function toggleStrategy(strategyId: Strategy, enabled: boolean) {
    const updated = enabled
      ? [...enabledStrategies, strategyId]
      : enabledStrategies.filter((s) => s !== strategyId);

    setEnabledStrategies(updated);

    const { error } = await supabase
      .from("bot_config")
      .upsert({ key: "technical_strategies", value: updated as any, updated_at: new Date().toISOString() }, { onConflict: "key" });

    if (error) {
      toast({ title: "Błąd zapisu", description: error.message, variant: "destructive" });
      setEnabledStrategies(enabledStrategies); // rollback
    } else {
      toast({
        title: enabled ? `✅ ${strategyId} aktywowana` : `⏸️ ${strategyId} wyłączona`,
      });
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Strategie Techniczne
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Wskaźniki analizy technicznej używane przez bota do podejmowania decyzji BUY.
            Aktywne: {enabledStrategies.length}/{STRATEGY_META.length}
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          <Zap className="h-3 w-3 mr-1" />
          {enabledStrategies.length} aktywnych
        </Badge>
      </div>

      {/* Strategy Cards */}
      {STRATEGY_META.map((meta) => {
        const isEnabled = enabledStrategies.includes(meta.id);
        const isExpanded = expandedStrategy === meta.id;
        const details = configDetails[meta.id];

        return (
          <Card
            key={meta.id}
            className={`border-border bg-card transition-all ${
              isEnabled ? "ring-1 ring-primary/30" : "opacity-80"
            }`}
          >
            <CardContent className="p-4">
              {/* Main row */}
              <div className="flex items-start justify-between gap-3">
                <div
                  className="flex-1 cursor-pointer"
                  onClick={() => setExpandedStrategy(isExpanded ? null : meta.id)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{meta.icon}</span>
                    <span className="font-bold text-foreground">{meta.name}</span>
                    <Badge className={`text-[10px] ${riskColors[meta.riskLevel]}`}>
                      {riskLabels[meta.riskLevel]} ryzyko
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      <Clock className="h-2.5 w-2.5 mr-0.5" />
                      {meta.timeframe}
                    </Badge>
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {meta.description}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {meta.indicators.map((ind) => (
                      <Badge key={ind} variant="secondary" className="text-[10px] px-2 py-0.5">
                        {ind}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Switch
                  checked={isEnabled}
                  onCheckedChange={(checked) => toggleStrategy(meta.id, checked)}
                  disabled={loading}
                />
              </div>

              {/* Expanded config details */}
              {isExpanded && (
                <>
                  <Separator className="my-3" />
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {Object.entries(details).map(([label, value]) => (
                      <div key={label} className="bg-muted/30 rounded-lg p-2.5">
                        <span className="text-[10px] text-muted-foreground block">{label}</span>
                        <span className="text-sm font-mono font-semibold text-foreground">
                          {Array.isArray(value) ? value.join(", ") : value}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 bg-muted/20 rounded-lg p-3 border border-border">
                    <div className="flex items-start gap-2">
                      <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div className="text-xs text-muted-foreground">
                        <strong className="text-foreground">Jak to działa:</strong>{" "}
                        {meta.id === "volume_explosion" &&
                          "Bot czeka na przecięcie EMA 9 powyżej EMA 21 (golden cross) z jednoczesnym wolumenem 4x powyżej średniej. RSI musi być powyżej 50 (momentum bycze). Token musi mieć < 30 min."}
                        {meta.id === "rsi_divergence" &&
                          "Bot szuka tokenów z RSI < 35 (silna wyprzedaż) i jednocześnie rosnącym wolumenem 3.5x. To sugeruje akumulację — smart money kupują gdy inni panikują."}
                        {meta.id === "ema_ribbon" &&
                          "Wstęga 5 EMA (8/13/21/34/55) musi być w formacji byczej (krótsze > dłuższych). Cena musi dotykać najkrótszej EMA (pullback). To klasyczny setup trend-following."}
                        {meta.id === "vwap_reversion" &&
                          "Cena poniżej VWAP + RSI < 40 + wolumen 3x = token jest tańszy niż średnia ważona wolumenem. Mean-reversion trade z oczekiwaniem powrotu do VWAP."}
                        {meta.id === "triple_momentum" &&
                          "Najsilniejszy sygnał: EMA 9 > 21 (short-term momentum), cena > EMA 200 (long-term trend), RSI > 55 (siła), wolumen 5x (potwierdzenie). Wymaga konsensusu."}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Info */}
      <Card className="border-border bg-muted/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-neon-amber shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong className="text-foreground">Jak strategie współpracują z pipeline:</strong></p>
              <p>Aktywne strategie techniczne są uruchamiane po przejściu tokena przez filtry bezpieczeństwa i płynności. Jeśli którakolwiek aktywna strategia zwróci sygnał BUY, token otrzymuje bonus do score (+10 pkt).</p>
              <p>Jeśli żadna strategia nie jest aktywna, bot używa domyślnego scoringu (bezpieczeństwo + płynność + smart money).</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
