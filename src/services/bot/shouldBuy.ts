import type { Strategy, MarketData } from "./types";
import { strategies } from "./strategies";

export function shouldBuy(strategy: Strategy, data: MarketData): boolean {
  switch (strategy) {
    case "volume_explosion":
      return strategies.volumeExplosionStrategy(data);
    case "rsi_divergence":
      return strategies.rsiDivergenceStrategy(data);
    case "ema_ribbon":
      return strategies.emaRibbonStrategy(data);
    case "vwap_reversion":
      return strategies.vwapReversionStrategy(data);
    case "triple_momentum":
      return strategies.tripleMomentumStrategy(data);
    default:
      return false;
  }
}

/**
 * Run all enabled strategies against market data.
 * Returns list of strategies that triggered a BUY signal.
 */
export function evaluateAllStrategies(
  enabledStrategies: Strategy[],
  data: MarketData
): Strategy[] {
  return enabledStrategies.filter((s) => shouldBuy(s, data));
}
