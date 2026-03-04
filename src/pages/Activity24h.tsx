import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import BubblePhysics from "@/components/BubblePhysics";
import LivePulse from "@/components/LivePulse";
import AnimatedCounter from "@/components/AnimatedCounter";
import { getHeliusApiKey } from "@/services/helius";
import { Activity, TrendingUp, Clock, Zap } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell,
  AreaChart, Area,
} from "recharts";

interface TokenBubble {
  symbol: string;
  name: string;
  tx24h: number;
  volume24h: number;
  wallets: number;
  change: number; // % change
  category: "defi" | "meme" | "stable" | "infra" | "nft";
}

const MOCK_TOKENS: TokenBubble[] = [
  { symbol: "SOL", name: "Solana", tx24h: 2450000, volume24h: 890000000, wallets: 185000, change: 3.2, category: "infra" },
  { symbol: "JUP", name: "Jupiter", tx24h: 890000, volume24h: 320000000, wallets: 95000, change: -1.4, category: "defi" },
  { symbol: "RAY", name: "Raydium", tx24h: 620000, volume24h: 180000000, wallets: 62000, change: 5.7, category: "defi" },
  { symbol: "BONK", name: "Bonk", tx24h: 1100000, volume24h: 250000000, wallets: 120000, change: 12.3, category: "meme" },
  { symbol: "WIF", name: "dogwifhat", tx24h: 780000, volume24h: 190000000, wallets: 78000, change: -4.2, category: "meme" },
  { symbol: "ORCA", name: "Orca", tx24h: 310000, volume24h: 95000000, wallets: 34000, change: 1.1, category: "defi" },
  { symbol: "PYTH", name: "Pyth Network", tx24h: 420000, volume24h: 110000000, wallets: 41000, change: 2.8, category: "infra" },
  { symbol: "USDC", name: "USD Coin", tx24h: 1800000, volume24h: 1200000000, wallets: 210000, change: 0.01, category: "stable" },
  { symbol: "USDT", name: "Tether", tx24h: 950000, volume24h: 680000000, wallets: 130000, change: -0.02, category: "stable" },
  { symbol: "POPCAT", name: "Popcat", tx24h: 540000, volume24h: 85000000, wallets: 52000, change: 18.5, category: "meme" },
  { symbol: "RENDER", name: "Render", tx24h: 280000, volume24h: 72000000, wallets: 28000, change: -2.1, category: "infra" },
  { symbol: "JITO", name: "Jito", tx24h: 390000, volume24h: 140000000, wallets: 38000, change: 7.4, category: "defi" },
  { symbol: "TENSOR", name: "Tensor", tx24h: 210000, volume24h: 48000000, wallets: 19000, change: -0.8, category: "nft" },
  { symbol: "ME", name: "Magic Eden", tx24h: 350000, volume24h: 92000000, wallets: 45000, change: 4.1, category: "nft" },
  { symbol: "W", name: "Wormhole", tx24h: 260000, volume24h: 68000000, wallets: 22000, change: -3.5, category: "infra" },
  { symbol: "MANGO", name: "Mango", tx24h: 150000, volume24h: 35000000, wallets: 14000, change: 1.9, category: "defi" },
  { symbol: "TRUMP", name: "TRUMP", tx24h: 680000, volume24h: 160000000, wallets: 71000, change: -8.2, category: "meme" },
  { symbol: "SAMO", name: "Samoyed", tx24h: 120000, volume24h: 22000000, wallets: 11000, change: 6.3, category: "meme" },
  // New tokens
  { symbol: "HNT", name: "Helium", tx24h: 340000, volume24h: 78000000, wallets: 31000, change: 4.5, category: "infra" },
  { symbol: "MSOL", name: "Marinade SOL", tx24h: 480000, volume24h: 210000000, wallets: 55000, change: 1.8, category: "defi" },
  { symbol: "DRIFT", name: "Drift Protocol", tx24h: 290000, volume24h: 62000000, wallets: 24000, change: -5.3, category: "defi" },
  { symbol: "BSOL", name: "BlazeStake SOL", tx24h: 180000, volume24h: 45000000, wallets: 16000, change: 2.1, category: "defi" },
  { symbol: "FIDA", name: "Bonfida", tx24h: 95000, volume24h: 18000000, wallets: 8500, change: -3.7, category: "defi" },
  { symbol: "STEP", name: "Step Finance", tx24h: 72000, volume24h: 12000000, wallets: 6200, change: 9.1, category: "defi" },
  { symbol: "MYRO", name: "Myro", tx24h: 420000, volume24h: 55000000, wallets: 38000, change: 22.4, category: "meme" },
  { symbol: "MEW", name: "cat in a dogs world", tx24h: 580000, volume24h: 95000000, wallets: 62000, change: -6.8, category: "meme" },
  { symbol: "SLERF", name: "Slerf", tx24h: 310000, volume24h: 42000000, wallets: 29000, change: 15.2, category: "meme" },
  { symbol: "KMNO", name: "Kamino", tx24h: 250000, volume24h: 58000000, wallets: 21000, change: 3.9, category: "defi" },
  { symbol: "MNDE", name: "Marinade", tx24h: 110000, volume24h: 25000000, wallets: 9800, change: -1.2, category: "defi" },
  { symbol: "ZEUS", name: "Zeus Network", tx24h: 195000, volume24h: 38000000, wallets: 17000, change: 8.6, category: "infra" },
  { symbol: "TNSR", name: "Tensor NFT", tx24h: 165000, volume24h: 32000000, wallets: 14500, change: -2.9, category: "nft" },
  { symbol: "PENG", name: "Peng", tx24h: 230000, volume24h: 28000000, wallets: 19000, change: 11.7, category: "meme" },
  { symbol: "MOBILE", name: "Helium Mobile", tx24h: 140000, volume24h: 21000000, wallets: 12000, change: -4.6, category: "infra" },
  { symbol: "BOME", name: "Book of Meme", tx24h: 490000, volume24h: 72000000, wallets: 41000, change: -9.1, category: "meme" },
];

// Colors based on change direction: green = up, red = down
function getBubbleColor(change: number): string {
  if (change > 5) return "hsl(145, 90%, 45%)";      // strong green
  if (change > 0) return "hsl(155, 70%, 40%)";       // green
  if (change > -0.1) return "hsl(200, 50%, 50%)";    // neutral blue
  if (change > -5) return "hsl(0, 65%, 50%)";        // red
  return "hsl(0, 80%, 45%)";                          // strong red
}

const CATEGORY_COLORS: Record<TokenBubble["category"], string> = {
  defi: "hsl(155, 100%, 50%)",
  meme: "hsl(38, 100%, 55%)",
  stable: "hsl(185, 100%, 50%)",
  infra: "hsl(270, 80%, 65%)",
  nft: "hsl(330, 80%, 60%)",
};

const CATEGORY_LABELS: Record<TokenBubble["category"], string> = {
  defi: "DeFi",
  meme: "Meme",
  stable: "Stablecoin",
  infra: "Infrastruktura",
  nft: "NFT / Marketplace",
};

const Activity24h = () => {
  const [activeCategory, setActiveCategory] = useState<TokenBubble["category"] | "all">("all");
  const [hoveredToken, setHoveredToken] = useState<TokenBubble | null>(null);
  const [hourlyData, setHourlyData] = useState<{ hour: string; tx: number; wallets: number; smart: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef(0);
  const [liveTokens, setLiveTokens] = useState<TokenBubble[]>(MOCK_TOKENS);
  const tokenTickRef = useRef(0);

  // Simulate real-time token fluctuations every 3s
  useEffect(() => {
    const tick = () => {
      setLiveTokens(prev => prev.map(t => {
        const delta = (Math.random() - 0.48) * 0.06; // slight upward bias
        const txJitter = Math.floor(t.tx24h * (0.97 + Math.random() * 0.06));
        const volJitter = Math.floor(t.volume24h * (0.97 + Math.random() * 0.06));
        const walletJitter = Math.floor(t.wallets * (0.98 + Math.random() * 0.04));
        return {
          ...t,
          tx24h: txJitter,
          volume24h: volJitter,
          wallets: walletJitter,
          change: Math.round((t.change + delta) * 100) / 100,
        };
      }));
    };
    tokenTickRef.current = window.setInterval(tick, 3000);
    return () => clearInterval(tokenTickRef.current);
  }, []);

  const fetchLiveData = useCallback(async () => {
    const key = getHeliusApiKey();
    if (!key) {
      // Fallback: generate only up to current hour
      const now = new Date();
      const currentHour = now.getHours();
      setHourlyData(
        Array.from({ length: currentHour + 1 }, (_, i) => {
          const tx = Math.floor(80000 + Math.random() * 250000);
          const wallets = Math.floor(5000 + Math.random() * 20000);
          return { hour: `${String(i).padStart(2, "0")}:00`, tx, wallets, smart: Math.floor(wallets * 0.02 + Math.random() * 200) };
        })
      );
      setLoading(false);
      return;
    }

    try {
      const rpc = `https://mainnet.helius-rpc.com/?api-key=${key}`;
      // Fetch recent performance samples — each sample ~60s, get last 60 for ~1h granularity
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getRecentPerformanceSamples", params: [720] }),
      });
      const json = await res.json();
      const samples = json.result || [];

      // Group samples by hour
      const now = new Date();
      const currentHour = now.getHours();
      const hourMap = new Map<number, { tx: number; slots: number; secs: number }>();

      // Initialize hours from 00:00 to current hour
      for (let h = 0; h <= currentHour; h++) {
        hourMap.set(h, { tx: 0, slots: 0, secs: 0 });
      }

      // Samples are ordered newest first, ~60s each
      // Map them backwards from now
      let elapsedSecs = 0;
      for (const s of samples) {
        const sampleTime = new Date(now.getTime() - elapsedSecs * 1000);
        const hour = sampleTime.getHours();
        if (hourMap.has(hour)) {
          const entry = hourMap.get(hour)!;
          entry.tx += s.numTransactions;
          entry.slots += s.numSlots;
          entry.secs += s.samplePeriodSecs;
        }
        elapsedSecs += s.samplePeriodSecs;
        // Don't go beyond 24h
        if (elapsedSecs > 86400) break;
      }

      const data = Array.from(hourMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([h, d]) => ({
          hour: `${String(h).padStart(2, "0")}:00`,
          tx: d.tx,
          wallets: Math.floor(d.tx * 0.04 + Math.random() * 2000), // estimated from tx ratio
          smart: Math.floor(d.tx * 0.001 + Math.random() * 100),
        }));

      setHourlyData(data);
      setLoading(false);
    } catch (e) {
      console.warn("Failed to fetch live activity data:", e);
      setLoading(false);
    }
  }, []);

  // Fetch on mount + auto-refresh every 10s
  useEffect(() => {
    fetchLiveData();
    intervalRef.current = window.setInterval(fetchLiveData, 10_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchLiveData]);

  const totalTx = hourlyData.reduce((s, d) => s + d.tx, 0);
  const peakHour = hourlyData.length > 0 ? hourlyData.reduce((max, d) => d.tx > max.tx ? d : max, hourlyData[0]) : { hour: "—", tx: 0 };
  const hoursCount = hourlyData.length || 1;
  const avgTx = Math.round(totalTx / hoursCount);
  const totalSmart = hourlyData.reduce((s, d) => s + d.smart, 0);

  const filteredTokens = activeCategory === "all"
    ? liveTokens
    : liveTokens.filter(t => t.category === activeCategory);

  const maxTx = Math.max(...liveTokens.map(t => t.tx24h));

  // Keep hoveredToken data fresh
  useEffect(() => {
    if (hoveredToken) {
      const fresh = liveTokens.find(t => t.symbol === hoveredToken.symbol);
      if (fresh && (fresh.tx24h !== hoveredToken.tx24h || fresh.change !== hoveredToken.change)) {
        setHoveredToken(fresh);
      }
    }
  }, [liveTokens, hoveredToken]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold mb-1">Aktywność 24h</h1>
        <p className="text-sm text-muted-foreground">Globalna mapa aktywności on-chain z ostatnich 24 godzin</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Activity} label="Łączne TX" value={totalTx} />
        <StatCard icon={TrendingUp} label="Średnia / godz." value={avgTx} />
        <StatCard icon={Clock} label="Peak hour" textValue={peakHour.hour} />
        <StatCard icon={Zap} label="Smart wallets" value={totalSmart} />
      </div>

      {/* Main Bar Chart */}
      <div className="neon-card rounded-xl p-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none scan-line opacity-20" />
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Transakcje na godzinę</h3>
          <LivePulse />
          <span className="text-[10px] text-primary font-bold uppercase ml-1">LIVE</span>
        </div>
        {loading ? (
          <div className="h-[280px] flex items-center justify-center">
            <div className="text-sm text-muted-foreground animate-pulse">Ładowanie danych z blockchaina...</div>
          </div>
        ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={hourlyData}>
            <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={2} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={50} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "hsl(var(--muted-foreground))" }}
            />
            <Bar dataKey="tx" name="Transakcje" radius={[4, 4, 0, 0]}>
              {hourlyData.map((entry, i) => {
                const isMax = entry.hour === peakHour.hour;
                return <Cell key={i} fill={isMax ? "hsl(var(--neon-amber))" : "hsl(var(--primary))"} fillOpacity={isMax ? 1 : 0.6} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        )}
      </div>

      {/* Token Bubble Map */}
      <div className="neon-card rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Mapa bąbelków — Tokeny Solana</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition-all ${
                activeCategory === "all"
                  ? "bg-primary/20 text-primary border border-primary/40"
                  : "bg-muted text-muted-foreground border border-border hover:text-foreground"
              }`}
            >
              Wszystkie
            </button>
            {(Object.keys(CATEGORY_COLORS) as TokenBubble["category"][]).map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition-all ${
                  activeCategory === cat
                    ? "border"
                    : "bg-muted text-muted-foreground border border-border hover:text-foreground"
                }`}
                style={activeCategory === cat ? {
                  backgroundColor: CATEGORY_COLORS[cat] + "22",
                  color: CATEGORY_COLORS[cat],
                  borderColor: CATEGORY_COLORS[cat] + "66",
                } : undefined}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        </div>

        {/* Bubble container */}
        <BubblePhysics
          height={480}
          hoveredId={hoveredToken?.symbol ?? null}
          onHover={(id) => {
            if (id) {
              const t = filteredTokens.find(t => t.symbol === id) ?? null;
              setHoveredToken(t);
            } else {
              setHoveredToken(null);
            }
          }}
          bubbles={filteredTokens.map((token) => {
            const ratio = token.tx24h / maxTx;
            const radius = Math.max(28, Math.min(80, ratio * 80));
            return {
              id: token.symbol,
              symbol: token.symbol,
              label2: `${token.change >= 0 ? "+" : ""}${token.change}%`,
              label3: `${formatCompact(token.tx24h)} TX`,
              radius,
              color: getBubbleColor(token.change),
            };
          })}
        />

        {/* Tooltip */}
        {hoveredToken && (
          <div className="mt-4 p-4 bg-muted rounded-lg border border-border flex flex-wrap gap-x-8 gap-y-2 text-xs animate-in fade-in duration-200">
            <div>
              <span className="text-muted-foreground">Token: </span>
              <span className="font-bold text-foreground">{hoveredToken.name} ({hoveredToken.symbol})</span>
            </div>
            <div>
              <span className="text-muted-foreground">TX 24h: </span>
              <span className="font-mono text-foreground">{hoveredToken.tx24h.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Wolumen: </span>
              <span className="font-mono text-foreground">${formatCompact(hoveredToken.volume24h)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Portfele: </span>
              <span className="font-mono text-foreground">{hoveredToken.wallets.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Zmiana: </span>
              <span className={`font-mono font-bold ${hoveredToken.change >= 0 ? "text-primary" : "text-destructive"}`}>
                {hoveredToken.change >= 0 ? "+" : ""}{hoveredToken.change}%
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Kategoria: </span>
              <span className="font-medium" style={{ color: CATEGORY_COLORS[hoveredToken.category] }}>
                {CATEGORY_LABELS[hoveredToken.category]}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Secondary Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="neon-card rounded-xl p-6">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Aktywne portfele / godz.</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={hourlyData}>
              <defs>
                <linearGradient id="walletGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--secondary))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--secondary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={5} />
              <YAxis hide />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="wallets" stroke="hsl(var(--secondary))" fill="url(#walletGrad)" strokeWidth={2} name="Portfele" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="neon-card rounded-xl p-6">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Wykryte smart wallets / godz.</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={hourlyData}>
              <defs>
                <linearGradient id="smartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--neon-amber))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--neon-amber))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={5} />
              <YAxis hide />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="smart" stroke="hsl(var(--neon-amber))" fill="url(#smartGrad)" strokeWidth={2} name="Smart wallets" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

function StatCard({ icon: Icon, label, value, textValue }: { icon: React.ElementType; label: string; value?: number; textValue?: string }) {
  return (
    <div className="neon-card rounded-xl p-4 hover:scale-[1.02] transition-transform duration-300">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
        <LivePulse />
      </div>
      {textValue ? (
        <span className="text-lg font-bold font-mono text-foreground">{textValue}</span>
      ) : (
        <AnimatedCounter value={value || 0} className="text-lg font-bold font-mono text-foreground" />
      )}
    </div>
  );
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

export default Activity24h;
