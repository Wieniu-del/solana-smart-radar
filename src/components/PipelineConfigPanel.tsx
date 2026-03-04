import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Save, RotateCcw, Users, Shield, Droplets, Activity,
  Target, Zap, ShieldAlert, Brain, GitMerge, Loader2
} from "lucide-react";

export interface PipelineConfig {
  security_check: { enabled: boolean; min_score: number };
  liquidity_check: { enabled: boolean; min_value_usd: number };
  wallet_analysis: { enabled: boolean; min_wallet_value_usd: number };
  scoring: { buy_threshold: number; watch_threshold: number };
  correlation: { enabled: boolean; min_wallets: number; bonus_per_wallet: number; max_bonus: number };
  sentiment: { enabled: boolean; block_on_avoid: boolean };
  auto_execute: { enabled: boolean; min_confidence: number };
  risk_manager: { trailing_stop: boolean; take_profit: boolean };
}

const DEFAULT_CONFIG: PipelineConfig = {
  security_check: { enabled: true, min_score: 30 },
  liquidity_check: { enabled: true, min_value_usd: 1000 },
  wallet_analysis: { enabled: true, min_wallet_value_usd: 10000 },
  scoring: { buy_threshold: 70, watch_threshold: 45 },
  correlation: { enabled: true, min_wallets: 2, bonus_per_wallet: 8, max_bonus: 20 },
  sentiment: { enabled: true, block_on_avoid: true },
  auto_execute: { enabled: false, min_confidence: 80 },
  risk_manager: { trailing_stop: true, take_profit: true },
};

export default function PipelineConfigPanel() {
  const [config, setConfig] = useState<PipelineConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState<PipelineConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("bot_config")
        .select("value")
        .eq("key", "pipeline_config")
        .single();
      if (data?.value) {
        const merged = { ...DEFAULT_CONFIG, ...(data.value as any) };
        setConfig(merged);
        setSaved(merged);
      }
    } catch { /* use defaults */ }
    setLoading(false);
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from("bot_config")
        .select("id")
        .eq("key", "pipeline_config")
        .single();

      if (existing) {
        await supabase
          .from("bot_config")
          .update({ value: config as any, updated_at: new Date().toISOString() })
          .eq("key", "pipeline_config");
      } else {
        await supabase
          .from("bot_config")
          .insert({ key: "pipeline_config", value: config as any });
      }
      setSaved(config);
      toast({ title: "✅ Pipeline zapisany", description: "Konfiguracja etapów pipeline'u została zaktualizowana" });
    } catch (e: any) {
      toast({ title: "Błąd", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const resetToDefaults = () => {
    setConfig(DEFAULT_CONFIG);
    toast({ title: "Przywrócono domyślne", description: "Kliknij Zapisz aby zatwierdzić" });
  };

  const hasChanges = JSON.stringify(config) !== JSON.stringify(saved);

  const updateStep = <K extends keyof PipelineConfig>(
    step: K,
    field: keyof PipelineConfig[K],
    value: any
  ) => {
    setConfig(prev => ({
      ...prev,
      [step]: { ...prev[step], [field]: value },
    }));
  };

  if (loading) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const steps = [
    {
      id: "security_check",
      icon: Shield,
      name: "Skan bezpieczeństwa",
      desc: "Sprawdzanie rugpull, mint authority, freeze authority",
      enabled: config.security_check.enabled,
      onToggle: (v: boolean) => updateStep("security_check", "enabled", v),
      controls: (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Min. security score</span>
            <span className="font-mono text-foreground">{config.security_check.min_score}</span>
          </div>
          <Slider
            value={[config.security_check.min_score]}
            onValueChange={([v]) => updateStep("security_check", "min_score", v)}
            min={0} max={100} step={5}
            disabled={!config.security_check.enabled}
          />
        </div>
      ),
    },
    {
      id: "liquidity_check",
      icon: Droplets,
      name: "Analiza płynności",
      desc: "Sprawdzanie LP, volume, wartość tokenu",
      enabled: config.liquidity_check.enabled,
      onToggle: (v: boolean) => updateStep("liquidity_check", "enabled", v),
      controls: (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Min. wartość USD</span>
            <span className="font-mono text-foreground">${config.liquidity_check.min_value_usd.toLocaleString()}</span>
          </div>
          <Slider
            value={[config.liquidity_check.min_value_usd]}
            onValueChange={([v]) => updateStep("liquidity_check", "min_value_usd", v)}
            min={0} max={100000} step={500}
            disabled={!config.liquidity_check.enabled}
          />
        </div>
      ),
    },
    {
      id: "wallet_analysis",
      icon: Activity,
      name: "Analiza portfela",
      desc: "Scoring wartości portfela źródłowego",
      enabled: config.wallet_analysis.enabled,
      onToggle: (v: boolean) => updateStep("wallet_analysis", "enabled", v),
      controls: (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Min. wartość portfela USD</span>
            <span className="font-mono text-foreground">${config.wallet_analysis.min_wallet_value_usd.toLocaleString()}</span>
          </div>
          <Slider
            value={[config.wallet_analysis.min_wallet_value_usd]}
            onValueChange={([v]) => updateStep("wallet_analysis", "min_wallet_value_usd", v)}
            min={0} max={500000} step={5000}
            disabled={!config.wallet_analysis.enabled}
          />
        </div>
      ),
    },
    {
      id: "scoring",
      icon: Target,
      name: "Scoring & progi",
      desc: "Progi decyzji BUY / WATCH / SKIP",
      enabled: true,
      controls: (
        <div className="mt-3 space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Próg BUY</span>
              <span className="font-mono text-primary font-bold">{config.scoring.buy_threshold}</span>
            </div>
            <Slider
              value={[config.scoring.buy_threshold]}
              onValueChange={([v]) => updateStep("scoring", "buy_threshold", v)}
              min={30} max={95} step={5}
            />
          </div>
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Próg WATCH</span>
              <span className="font-mono text-neon-amber font-bold">{config.scoring.watch_threshold}</span>
            </div>
            <Slider
              value={[config.scoring.watch_threshold]}
              onValueChange={([v]) => updateStep("scoring", "watch_threshold", v)}
              min={10} max={70} step={5}
            />
          </div>
          <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2">
            Score ≥ {config.scoring.buy_threshold} → <span className="text-primary">KUP</span> · 
            Score ≥ {config.scoring.watch_threshold} → <span className="text-neon-amber">OBSERWUJ</span> · 
            Poniżej → <span className="text-destructive">POMIŃ</span>
          </div>
        </div>
      ),
    },
    {
      id: "correlation",
      icon: GitMerge,
      name: "Korelacja Smart Money",
      desc: "Bonus gdy 2+ portfeli kupuje ten sam token",
      enabled: config.correlation.enabled,
      onToggle: (v: boolean) => updateStep("correlation", "enabled", v),
      controls: (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Min. portfeli do korelacji</span>
            <span className="font-mono text-foreground">{config.correlation.min_wallets}</span>
          </div>
          <Slider
            value={[config.correlation.min_wallets]}
            onValueChange={([v]) => updateStep("correlation", "min_wallets", v)}
            min={2} max={5} step={1}
            disabled={!config.correlation.enabled}
          />
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Bonus/portfel · Max bonus</span>
            <span className="font-mono text-foreground">+{config.correlation.bonus_per_wallet} · max +{config.correlation.max_bonus}</span>
          </div>
        </div>
      ),
    },
    {
      id: "sentiment",
      icon: Brain,
      name: "AI Analiza sentymentu",
      desc: "Gemini ocena tokenu przed decyzją BUY",
      enabled: config.sentiment.enabled,
      onToggle: (v: boolean) => updateStep("sentiment", "enabled", v),
      controls: (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Blokuj BUY przy AVOID</span>
            <Switch
              checked={config.sentiment.block_on_avoid}
              onCheckedChange={(v) => updateStep("sentiment", "block_on_avoid", v)}
              disabled={!config.sentiment.enabled}
            />
          </div>
        </div>
      ),
    },
    {
      id: "auto_execute",
      icon: Zap,
      name: "Auto-wykonanie",
      desc: "Automatyczny swap przez Jupiter DEX",
      enabled: config.auto_execute.enabled,
      onToggle: (v: boolean) => updateStep("auto_execute", "enabled", v),
      controls: (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Min. confidence do auto-execute</span>
            <span className="font-mono text-foreground">{config.auto_execute.min_confidence}%</span>
          </div>
          <Slider
            value={[config.auto_execute.min_confidence]}
            onValueChange={([v]) => updateStep("auto_execute", "min_confidence", v)}
            min={50} max={100} step={5}
            disabled={!config.auto_execute.enabled}
          />
        </div>
      ),
    },
    {
      id: "risk_manager",
      icon: ShieldAlert,
      name: "Risk Manager",
      desc: "Stop-Loss, Take-Profit, Trailing Stop",
      enabled: true,
      controls: (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Trailing Stop</span>
            <Switch
              checked={config.risk_manager.trailing_stop}
              onCheckedChange={(v) => updateStep("risk_manager", "trailing_stop", v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Take Profit</span>
            <Switch
              checked={config.risk_manager.take_profit}
              onCheckedChange={(v) => updateStep("risk_manager", "take_profit", v)}
            />
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="border-border bg-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Konfiguracja Pipeline
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Włączaj/wyłączaj etapy i dostosuj parametry decyzyjne bota
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={resetToDefaults} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" /> Domyślne
              </Button>
              <Button
                size="sm"
                onClick={saveConfig}
                disabled={!hasChanges || saving}
                className="gap-1.5 bg-primary text-primary-foreground"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Zapisz
              </Button>
            </div>
          </div>
          {hasChanges && (
            <div className="mt-2 text-[11px] text-neon-amber flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-neon-amber animate-pulse" />
              Masz niezapisane zmiany
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pipeline steps */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {steps.map((step, i) => (
          <Card key={step.id} className={`border-border transition-colors ${
            step.enabled !== false ? "bg-card" : "bg-muted/10 opacity-60"
          }`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-bold text-muted-foreground w-5 h-5 rounded-full bg-muted/50 flex items-center justify-center">
                      {i + 1}
                    </span>
                    <div className={`p-1.5 rounded-md ${step.enabled !== false ? "bg-primary/10" : "bg-muted/30"}`}>
                      <step.icon className={`h-4 w-4 ${step.enabled !== false ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{step.name}</span>
                      {step.enabled !== false ? (
                        <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px]">ON</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground text-[9px]">OFF</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{step.desc}</p>
                  </div>
                </div>
                {step.onToggle && (
                  <Switch
                    checked={step.enabled}
                    onCheckedChange={step.onToggle}
                  />
                )}
              </div>
              {step.controls}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
