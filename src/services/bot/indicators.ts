import type { Candle } from "./types";

export function ema(period: number, prices: number[]): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = prices[0];
  for (let i = 0; i < prices.length; i++) {
    const value = prices[i] * k + prev * (1 - k);
    result.push(value);
    prev = value;
  }
  return result;
}

export function rsi(period: number, prices: number[]): number {
  if (prices.length < period + 1) return 50; // neutral fallback
  let gains = 0;
  let losses = 0;
  for (let i = prices.length - period; i < prices.length - 1; i++) {
    const diff = prices[i + 1] - prices[i];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const rs = gains / (losses || 1);
  return 100 - 100 / (1 + rs);
}

export function avgVolume(candles: Candle[], length: number): number {
  const slice = candles.slice(-length);
  const total = slice.reduce((sum, c) => sum + c.volume, 0);
  return total / (slice.length || 1);
}

export function vwap(candles: Candle[]): number {
  let pv = 0;
  let volume = 0;
  for (const c of candles) {
    const price = (c.high + c.low + c.close) / 3;
    pv += price * c.volume;
    volume += c.volume;
  }
  return volume > 0 ? pv / volume : 0;
}
