export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface MarketData {
  candles: Candle[];
  ageMinutes: number;
}

export type Strategy =
  | "volume_explosion"
  | "rsi_divergence"
  | "ema_ribbon"
  | "vwap_reversion"
  | "triple_momentum";

export interface StrategyMeta {
  id: Strategy;
  name: string;
  description: string;
  icon: string;
  riskLevel: "low" | "medium" | "high";
  timeframe: string;
  indicators: string[];
}

export const STRATEGY_META: StrategyMeta[] = [
  {
    id: "volume_explosion",
    name: "Volume Explosion",
    description: "Wykrywa nagły wzrost wolumenu (4x średnia) + przecięcie EMA 9/21 + RSI > 50. Idealny do łapania początku pompek na młodych tokenach (<30 min).",
    icon: "🔥",
    riskLevel: "high",
    timeframe: "1-5 min",
    indicators: ["EMA 9/21", "RSI 14", "Volume 4x"],
  },
  {
    id: "rsi_divergence",
    name: "RSI Divergence",
    description: "Szuka wyprzedanych tokenów (RSI < 35) z jednoczesnym skokiem wolumenu (3.5x). Kontrariańska strategia — kupuj strach.",
    icon: "📉",
    riskLevel: "medium",
    timeframe: "5-15 min",
    indicators: ["RSI 14", "Volume 3.5x"],
  },
  {
    id: "ema_ribbon",
    name: "EMA Ribbon",
    description: "Wstęga EMA (8/13/21/34/55) w formacji byczej + cena dotyka najkrótszej EMA. Trend-following z potwierdzeniem wolumenu.",
    icon: "🎀",
    riskLevel: "low",
    timeframe: "15-60 min",
    indicators: ["EMA 8/13/21/34/55", "RSI 14", "Volume 2.5x"],
  },
  {
    id: "vwap_reversion",
    name: "VWAP Reversion",
    description: "Mean-reversion: cena poniżej VWAP + RSI < 40 + wolumen 3x. Kupuj dip do średniej ważonej wolumenem. Wymaga tokena >15 min.",
    icon: "🔄",
    riskLevel: "medium",
    timeframe: "15-60 min",
    indicators: ["VWAP", "RSI 14", "Volume 3x"],
  },
  {
    id: "triple_momentum",
    name: "Triple Momentum",
    description: "Potrójne potwierdzenie: EMA 9 > EMA 21, cena > EMA 200, RSI > 55, wolumen 5x. Najsilniejszy sygnał — wymaga konsensusu wszystkich wskaźników.",
    icon: "⚡",
    riskLevel: "high",
    timeframe: "5-15 min",
    indicators: ["EMA 9/21/200", "RSI 14", "Volume 5x"],
  },
];
