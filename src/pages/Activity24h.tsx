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
];

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

  const hourlyData = useMemo(() =>
    Array.from({ length: 24 }, (_, i) => {
      const tx = Math.floor(80000 + Math.random() * 250000);
      const wallets = Math.floor(5000 + Math.random() * 20000);
      return { hour: `${String(i).padStart(2, "0")}:00`, tx, wallets, smart: Math.floor(wallets * 0.02 + Math.random() * 200) };
    }), []);

  const totalTx = hourlyData.reduce((s, d) => s + d.tx, 0);
  const peakHour = hourlyData.reduce((max, d) => d.tx > max.tx ? d : max, hourlyData[0]);
  const avgTx = Math.round(totalTx / 24);
  const totalSmart = hourlyData.reduce((s, d) => s + d.smart, 0);

  const filteredTokens = activeCategory === "all"
    ? MOCK_TOKENS
    : MOCK_TOKENS.filter(t => t.category === activeCategory);

  const maxTx = Math.max(...MOCK_TOKENS.map(t => t.tx24h));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold mb-1">Aktywność 24h</h1>
        <p className="text-sm text-muted-foreground">Globalna mapa aktywności on-chain z ostatnich 24 godzin</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Activity} label="Łączne TX" value={totalTx.toLocaleString()} />
        <StatCard icon={TrendingUp} label="Średnia / godz." value={avgTx.toLocaleString()} />
        <StatCard icon={Clock} label="Peak hour" value={peakHour.hour} />
        <StatCard icon={Zap} label="Smart wallets" value={totalSmart.toLocaleString()} />
      </div>

      {/* Main Bar Chart */}
      <div className="neon-card rounded-xl p-6">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Transakcje na godzinę</h3>
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
              color: CATEGORY_COLORS[token.category],
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

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="neon-card rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className="text-lg font-bold font-mono text-foreground">{value}</span>
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
