import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Globe, Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle,
  Shield, Users, RefreshCw, Flame, Zap, Search
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface DiscoveredToken {
  name: string;
  symbol: string;
  mint: string | null;
  category: string;
  social_score: number;
  description: string;
  sources: string[];
  sentiment: "bullish" | "bearish" | "neutral";
  risk_level: "low" | "medium" | "high" | "extreme";
  trend_direction: "up" | "down" | "stable";
  estimated_volume_24h: string;
  holder_growth: string;
  why_trending: string;
}

type ScanCategory = "community" | "defi" | "nft" | "trending";

const CATEGORIES: { id: ScanCategory; label: string; icon: React.ReactNode }[] = [
  { id: "trending", label: "🔥 Trending", icon: <Flame className="h-3.5 w-3.5" /> },
  { id: "community", label: "👥 Community", icon: <Users className="h-3.5 w-3.5" /> },
  { id: "defi", label: "⚡ DeFi", icon: <Zap className="h-3.5 w-3.5" /> },
  { id: "nft", label: "🎨 NFT", icon: <Search className="h-3.5 w-3.5" /> },
];

export default function WebTokenDiscovery() {
  const [tokens, setTokens] = useState<DiscoveredToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<ScanCategory>("trending");
  const [marketMood, setMarketMood] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);

  const handleScan = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("web-token-discovery", {
        body: { category, limit: 10 },
      });

      if (error) throw error;

      if (data?.tokens) {
        setTokens(data.tokens);
        setMarketMood(data.market_mood || null);
        setScanSummary(data.scan_summary || null);
        setScannedAt(new Date().toLocaleTimeString("pl-PL"));
        toast.success(`Znaleziono ${data.tokens.length} tokenów`);
      } else {
        setTokens([]);
        toast.info("Brak wyników");
      }
    } catch (err: any) {
      console.error("Discovery error:", err);
      toast.error("Błąd skanowania — spróbuj ponownie");
    } finally {
      setLoading(false);
    }
  };

  const sentimentIcon = (s: string) => {
    if (s === "bullish") return <TrendingUp className="h-3.5 w-3.5 text-primary" />;
    if (s === "bearish") return <TrendingDown className="h-3.5 w-3.5 text-destructive" />;
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  const riskColor = (r: string) => {
    if (r === "low") return "bg-primary/10 text-primary border-primary/30";
    if (r === "medium") return "bg-yellow-500/10 text-yellow-500 border-yellow-500/30";
    if (r === "high") return "bg-orange-500/10 text-orange-500 border-orange-500/30";
    return "bg-destructive/10 text-destructive border-destructive/30";
  };

  const scoreColor = (score: number) => {
    if (score >= 80) return "text-primary";
    if (score >= 60) return "text-yellow-500";
    if (score >= 40) return "text-orange-500";
    return "text-muted-foreground";
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Web Discovery</h2>
          {scannedAt && (
            <span className="text-[10px] text-muted-foreground ml-2">
              Skan: {scannedAt}
            </span>
          )}
        </div>
        <Button onClick={handleScan} disabled={loading} size="sm">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
          {loading ? "Skanuję internet..." : "Skanuj"}
        </Button>
      </div>

      {/* Category selector */}
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
              category === cat.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            }`}
          >
            {cat.icon}
            {cat.label}
          </button>
        ))}
      </div>

      {/* Market mood & summary */}
      {marketMood && (
        <Card className="border-border bg-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Nastrój rynku:</span>
              <Badge variant="outline" className={
                marketMood === "bullish" ? "bg-primary/10 text-primary border-primary/30" :
                marketMood === "bearish" ? "bg-destructive/10 text-destructive border-destructive/30" :
                "bg-muted text-muted-foreground"
              }>
                {marketMood === "bullish" ? "🐂 Byczy" : marketMood === "bearish" ? "🐻 Niedźwiedzi" : "😐 Neutralny"}
              </Badge>
            </div>
            {scanSummary && (
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{scanSummary}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Token results */}
      {tokens.length > 0 && (
        <div className="space-y-2">
          {tokens.map((token, i) => (
            <Card key={i} className="border-border bg-card hover:border-muted-foreground/50 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {sentimentIcon(token.sentiment)}
                      <h3 className="font-bold text-foreground text-sm">
                        {token.name}
                        <span className="text-muted-foreground font-normal ml-1">({token.symbol})</span>
                      </h3>
                      <Badge variant="outline" className={riskColor(token.risk_level)}>
                        <Shield className="h-2.5 w-2.5 mr-0.5" />
                        {token.risk_level}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {token.category}
                      </Badge>
                    </div>

                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                      {token.description}
                    </p>

                    <p className="text-xs text-primary/80 mt-1 italic">
                      💡 {token.why_trending}
                    </p>

                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className={`text-xs font-mono font-bold ${scoreColor(token.social_score)}`}>
                        Social: {token.social_score}/100
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        Vol: {token.estimated_volume_24h}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        Holders: {token.holder_growth}
                      </span>
                      <div className="flex gap-1">
                        {token.sources.map((src) => (
                          <span key={src} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {src}
                          </span>
                        ))}
                      </div>
                    </div>

                    {token.mint && (
                      <p className="text-[10px] text-muted-foreground font-mono mt-1 truncate max-w-md">
                        Mint: {token.mint}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-center gap-1">
                    <div className={`text-2xl font-black ${scoreColor(token.social_score)}`}>
                      {token.social_score}
                    </div>
                    <span className="text-[9px] text-muted-foreground">SOCIAL</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && tokens.length === 0 && (
        <div className="text-center py-12">
          <Globe className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground text-sm">Kliknij "Skanuj" aby przeszukać internet</p>
          <p className="text-muted-foreground/60 text-xs mt-1">Bot przeszuka media społecznościowe i platformy DeFi</p>
        </div>
      )}
    </div>
  );
}
