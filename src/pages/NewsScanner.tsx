import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Newspaper, Search, Loader2, ExternalLink, Clock, TrendingUp,
  AlertTriangle, Info, RefreshCw
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface NewsItem {
  title: string;
  summary: string;
  url?: string;
  sentiment: "pozytywny" | "negatywny" | "neutralny";
  relevance: "wysoka" | "średnia" | "niska";
  timestamp: string;
}

export default function NewsScanner() {
  const [query, setQuery] = useState("Solana blockchain news");
  const [results, setResults] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);

  const presetQueries = [
    "Solana ekosystem najnowsze wiadomości",
    "Solana DeFi nowe projekty",
    "Solana memecoin trendy",
    "Jupiter DEX aktualizacje",
    "Solana NFT rynek",
    "Solana sieć wydajność",
  ];

  const handleScan = async () => {
    if (!query.trim()) {
      toast.error("Wpisz zapytanie do wyszukania");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("news-scanner", {
        body: { query: query.trim() },
      });

      if (error) throw error;

      if (data?.results) {
        setResults(data.results);
        setLastScan(new Date().toLocaleTimeString("pl-PL"));
        toast.success(`Znaleziono ${data.results.length} wiadomości`);
      } else {
        setResults([]);
        toast.info("Brak wyników dla tego zapytania");
      }
    } catch (err: any) {
      console.error("News scan error:", err);
      toast.error("Błąd skanowania — sprawdź połączenie");
      // Fallback: demo data
      setResults(getDemoNews());
      setLastScan(new Date().toLocaleTimeString("pl-PL"));
      toast.info("Wyświetlam dane demonstracyjne");
    } finally {
      setLoading(false);
    }
  };

  const sentimentIcon = (s: NewsItem["sentiment"]) => {
    if (s === "pozytywny") return <TrendingUp className="h-3.5 w-3.5 text-primary" />;
    if (s === "negatywny") return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
    return <Info className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  const sentimentColor = (s: NewsItem["sentiment"]) => {
    if (s === "pozytywny") return "bg-primary/10 text-primary border-primary/30";
    if (s === "negatywny") return "bg-destructive/10 text-destructive border-destructive/30";
    return "bg-muted text-muted-foreground border-border";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Newspaper className="h-8 w-8 text-neon-amber" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Skaner Wiadomości</h1>
          <p className="text-sm text-muted-foreground">Przeszukuj internet w poszukiwaniu informacji o Solanie</p>
        </div>
      </div>

      {/* Search */}
      <Card className="border-border bg-card">
        <CardContent className="p-6 space-y-4">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Wpisz temat do wyszukania..."
              className="flex-1 bg-muted border border-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
            />
            <Button onClick={handleScan} disabled={loading} className="px-6">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ml-2">{loading ? "Skanuję..." : "Szukaj"}</span>
            </Button>
          </div>

          {/* Presets */}
          <div className="flex flex-wrap gap-2">
            {presetQueries.map((pq) => (
              <button
                key={pq}
                onClick={() => { setQuery(pq); }}
                className="text-[11px] px-3 py-1 rounded-full border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                {pq}
              </button>
            ))}
          </div>

          {lastScan && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Ostatni skan: {lastScan}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Wyniki ({results.length})
            </h2>
            <Button variant="outline" size="sm" onClick={handleScan} disabled={loading}>
              <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
              Odśwież
            </Button>
          </div>

          {results.map((item, i) => (
            <Card key={i} className="border-border bg-card hover:border-muted-foreground/50 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{sentimentIcon(item.sentiment)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-foreground text-sm">{item.title}</h3>
                      <Badge className={sentimentColor(item.sentiment)} variant="outline">
                        {item.sentiment}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {item.relevance}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{item.summary}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] text-muted-foreground">{item.timestamp}</span>
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Źródło
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading && results.length === 0 && (
        <div className="text-center py-16">
          <Newspaper className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground text-sm">Wpisz zapytanie i kliknij Szukaj, aby przeskanować wiadomości</p>
        </div>
      )}
    </div>
  );
}

function getDemoNews(): NewsItem[] {
  return [
    {
      title: "Solana osiąga rekordowe TPS na mainnecie",
      summary: "Sieć Solana zarejestrowała rekordową liczbę transakcji na sekundę, co wskazuje na rosnące zainteresowanie ekosystemem i poprawę infrastruktury.",
      sentiment: "pozytywny",
      relevance: "wysoka",
      timestamp: new Date().toLocaleDateString("pl-PL"),
    },
    {
      title: "Jupiter DEX wprowadza nowe funkcje limit orderów",
      summary: "Największy agregator DEX na Solanie — Jupiter — ogłosił wprowadzenie zaawansowanych zleceń z limitem ceny, co zbliża DeFi do tradycyjnych giełd.",
      sentiment: "pozytywny",
      relevance: "wysoka",
      timestamp: new Date().toLocaleDateString("pl-PL"),
    },
    {
      title: "Ostrzeżenie: wzrost aktywności rugpullowych tokenów",
      summary: "Analitycy ostrzegają przed rosnącą liczbą podejrzanych tokenów na Solanie. Zalecają weryfikację kontraktów przed inwestycją.",
      sentiment: "negatywny",
      relevance: "średnia",
      timestamp: new Date().toLocaleDateString("pl-PL"),
    },
    {
      title: "Raydium aktualizuje pule płynności",
      summary: "Raydium v3 wprowadza skoncentrowaną płynność, co może zwiększyć efektywność handlu na Solanie.",
      sentiment: "neutralny",
      relevance: "średnia",
      timestamp: new Date().toLocaleDateString("pl-PL"),
    },
    {
      title: "Solana Foundation ogłasza nowy program grantów",
      summary: "Fundacja Solana przeznacza dodatkowe środki na rozwój ekosystemu deweloperów z naciskiem na DeFi i infrastrukturę.",
      sentiment: "pozytywny",
      relevance: "niska",
      timestamp: new Date().toLocaleDateString("pl-PL"),
    },
  ];
}
