import type { Strategy, MarketData, MarketPhase } from "./types";
import { strategies } from "./strategies";

/**
 * Select the best strategy based on token age (market phase).
 */
export function selectStrategy(ageMinutes: number): MarketPhase {
  if (ageMinutes < 15) return "launch";       // 0–15 min
  if (ageMinutes < 45) return "momentum";      // 15–45 min
  if (ageMinutes < 120) return "trending";     // 45–120 min
  return "mature";                              // 120+ min
}

/**
 * Get the strategies appropriate for each market phase.
 */
export function getPhaseStrategies(phase: MarketPhase): Strategy[] {
  switch (phase) {
    case "launch":
      return ["volume_explosion"];
    case "momentum":
      return ["volume_explosion", "triple_momentum"];
    case "trending":
      return ["ema_ribbon", "triple_momentum"];
    case "mature":
      return ["rsi_divergence", "vwap_reversion"];
  }
}

/**
 * Single strategy evaluation.
 */
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

/**
 * Age-based strategy engine with confirmation layer.
 * Selects strategies based on token age, runs them, and requires
 * at least 1 confirmation to trigger BUY.
 */
export function shouldBuyWithPhase(data: MarketData): {
  decision: boolean;
  phase: MarketPhase;
  strategy: string;
  confirmations: number;
  total: number;
  triggeredStrategies: Strategy[];
} {
  const phase = selectStrategy(data.ageMinutes);
  const phaseStrategies = getPhaseStrategies(phase);
  const triggered = phaseStrategies.filter((s) => shouldBuy(s, data));
  const decision = triggered.length >= 1;

  return {
    decision,
    phase,
    strategy: phase,
    confirmations: triggered.length,
    total: phaseStrategies.length,
    triggeredStrategies: triggered,
  };
}
