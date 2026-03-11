import type { MarketData } from "./types";
import { ema, rsi, avgVolume, vwap } from "./indicators";
import { config } from "./config";

function prices(data: MarketData): number[] {
  return data.candles.map((c) => c.close);
}

export function volumeExplosionStrategy(data: MarketData): boolean {
  if (data.candles.length < 3) return false;
  const p = prices(data);
  const ema9 = ema(config.volumeExplosion.emaShort, p);
  const ema21 = ema(config.volumeExplosion.emaLong, p);
  const currentVolume = data.candles.at(-1)!.volume;
  const avgVol = avgVolume(data.candles, 10);
  const r = rsi(14, p);

  const cross = ema9.at(-2)! < ema21.at(-2)! && ema9.at(-1)! > ema21.at(-1)!;
  const volumeOk = currentVolume > avgVol * config.volumeExplosion.volumeMultiplier; // 3x
  const rsiOk = r > config.volumeExplosion.rsiThreshold; // > 48
  const ageOk = data.ageMinutes < config.volumeExplosion.maxAgeMinutes; // < 45min

  return cross && volumeOk && rsiOk && ageOk;
}

export function rsiDivergenceStrategy(data: MarketData): boolean {
  if (data.candles.length < 3) return false;
  const p = prices(data);
  const r = rsi(14, p);
  const currentVolume = data.candles.at(-1)!.volume;
  const avgVol = avgVolume(data.candles, 10);

  const volumeOk = currentVolume > avgVol * config.rsiDivergence.volumeMultiplier;
  const rsiOk = r < config.rsiDivergence.rsiOversold;

  return volumeOk && rsiOk;
}

export function emaRibbonStrategy(data: MarketData): boolean {
  if (data.candles.length < 3) return false;
  const p = prices(data);
  const r = rsi(14, p);
  const currentVolume = data.candles.at(-1)!.volume;
  const avgVol = avgVolume(data.candles, 10);

  const ribbon = config.emaRibbon.ribbon.map((e) => ema(e, p).at(-1)!);
  const bullish = ribbon.every((v, i, arr) => i === 0 || v > arr[i - 1]);
  const price = p.at(-1)!;
  const touchingRibbon = price <= ribbon[0];
  const volumeOk = currentVolume > avgVol * config.emaRibbon.volumeMultiplier;
  const rsiOk = r > config.emaRibbon.rsiMin;

  return bullish && touchingRibbon && volumeOk && rsiOk;
}

export function vwapReversionStrategy(data: MarketData): boolean {
  if (data.candles.length < 3) return false;
  const p = prices(data);
  const price = p.at(-1)!;
  const r = rsi(14, p);
  const vw = vwap(data.candles);
  const currentVolume = data.candles.at(-1)!.volume;
  const avgVol = avgVolume(data.candles, 10);

  const volumeOk = currentVolume > avgVol * config.vwapReversion.volumeMultiplier;
  const priceBelow = price < vw;
  const rsiOk = r < config.vwapReversion.rsiMax;
  const ageOk = data.ageMinutes > config.vwapReversion.minAge;

  return priceBelow && volumeOk && rsiOk && ageOk;
}

export function tripleMomentumStrategy(data: MarketData): boolean {
  if (data.candles.length < 3) return false;
  const p = prices(data);
  const ema9 = ema(config.tripleMomentum.emaShort, p);    // 9
  const ema21 = ema(config.tripleMomentum.emaLong, p);     // 21
  const ema200 = ema(config.tripleMomentum.emaTrend, p);   // 200
  const r = rsi(14, p);
  const currentVolume = data.candles.at(-1)!.volume;
  const avgVol = avgVolume(data.candles, 10);

  const volumeOk = currentVolume > avgVol * config.tripleMomentum.volumeMultiplier; // 3.5x
  const emaCross = ema9.at(-1)! > ema21.at(-1)!;
  const trendOk = p.at(-1)! > ema200.at(-1)!;
  const rsiOk = r > config.tripleMomentum.rsiBuy; // > 50
  const ageOk = data.ageMinutes < config.tripleMomentum.maxAgeMinutes; // < 60min

  return emaCross && trendOk && volumeOk && rsiOk && ageOk;
}

export const strategies = {
  volumeExplosionStrategy,
  rsiDivergenceStrategy,
  emaRibbonStrategy,
  vwapReversionStrategy,
  tripleMomentumStrategy,
};
