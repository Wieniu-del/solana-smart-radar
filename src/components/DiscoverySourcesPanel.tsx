import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, BarChart3, Droplets, Loader2, Radar } from "lucide-react";

interface DiscoverySources {
  dexscreener_trending: boolean;
  volume_scanner: boolean;
  new_pool_detector: boolean;
}

const DEFAULT_SOURCES: DiscoverySources = {
  dexscreener_trending: true,
  volume_scanner: true,
  new_pool_detector: true,
};

const SOURCE_META = [
  {
    key: "dexscreener_trending" as keyof DiscoverySources,
    label: "DexScreener Trending",
    desc: "Top tokeny z DexScreener Boosted + Trending",
    icon: TrendingUp,
    color: "text-primary",
  },
  {
    key: "volume_scanner" as keyof DiscoverySources,
    label: "Volume Scanner",
    desc: "Tokeny z nagłym wzrostem wolumenu (>$50k/h)",
    icon: BarChart3,
    color: "text-neon-amber",
  },
  {
    key: "new_pool_detector" as keyof DiscoverySources,
    label: "New Pool Detector",
    desc: "Nowe pule płynności na Raydium / Orca",
    icon: Droplets,
    color: "text-secondary",
  },
];

export default function DiscoverySourcesPanel() {
  const [sources, setSources] = useState<DiscoverySources>(DEFAULT_SOURCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadSources();
  }, []);

  async function loadSources() {
    try {
      const { data } = await supabase
        .from("bot_config")
        .select("value")
        .eq("key", "discovery_sources")
        .maybeSingle();

      if (data?.value && typeof data.value === "object" && !Array.isArray(data.value)) {
        setSources({ ...DEFAULT_SOURCES, ...(data.value as Record<string, boolean>) });
      }
    } catch (e) {
      console.warn("[Discovery] Failed to load sources config:", e);
    } finally {
      setLoading(false);
    }
  }

  async function toggleSource(key: keyof DiscoverySources, enabled: boolean) {
    const updated = { ...sources, [key]: enabled };
    setSources(updated);
    setSaving(true);

    try {
      const { error } = await supabase
        .from("bot_config")
        .upsert({ key: "discovery_sources", value: updated as any }, { onConflict: "key" });

      if (error) throw error;

      toast({
        title: enabled ? "✅ Źródło włączone" : "⏸️ Źródło wyłączone",
        description: SOURCE_META.find((s) => s.key === key)?.label,
      });
    } catch (e: any) {
      setSources(sources); // revert
      toast({ title: "Błąd zapisu", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const activeCount = Object.values(sources).filter(Boolean).length;

  if (loading) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-6 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Ładowanie konfiguracji discovery...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Discovery Engine</h3>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {activeCount}/3 aktywne
          </Badge>
        </div>

        <div className="space-y-3">
          {SOURCE_META.map((source) => (
            <div
              key={source.key}
              className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/50"
            >
              <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-md bg-muted/50`}>
                  <source.icon className={`h-4 w-4 ${source.color}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{source.label}</p>
                  <p className="text-[11px] text-muted-foreground">{source.desc}</p>
                </div>
              </div>
              <Switch
                checked={sources[source.key]}
                onCheckedChange={(checked) => toggleSource(source.key, checked)}
                disabled={saving}
              />
            </div>
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground mt-3 text-center">
          Tokeny z discovery przechodzą identyczne Quality Gate jak tokeny z portfeli
        </p>
      </CardContent>
    </Card>
  );
}
