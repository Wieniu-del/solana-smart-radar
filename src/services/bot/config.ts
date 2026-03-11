export const config = {
  // ─── General Bot Settings ───
  scanInterval: 30,          // seconds
  maxOpenPositions: 3,
  minPositionSol: 0.03,
  maxPositionSol: 0.15,
  maxPositionTotal: 0.45,    // SOL total across all positions

  // ─── Risk Management ───
  stopLossPct: 22,           // -22% hard stop loss
  takeProfitPct: 999,        // TP disabled
  trailingStartPct: 25,      // trailing activates at +25% profit

  // Trailing Stop Table (pnlPct → trailingPct)
  trailingTable: [
    { minPnl: 80, trailing: 2 },
    { minPnl: 40, trailing: 2.5 },
    { minPnl: 20, trailing: 3 },
    { minPnl: 10, trailing: 3.5 },
    { minPnl: 0, trailing: 4 },
  ],

  // ─── Market Filters ───
  minLiquidityUsd: 15000,
  minVolume5m: 20000,
  maxTokenAgeMinutes: 60,
  maxSingleHolderPct: 20,
  mintAuthority: false,
  freezeAuthority: false,

  // ─── Smart Wallet Analysis ───
  smartWalletsTracked: 8,
  minWalletValueUsd: 50,
  minConfidence: 75,
  smartWalletBonus: 10,

  // ─── Scoring ───
  buyScoreThreshold: 60,
  minScoreForPosition: 65,

  // Dynamic sizing based on score
  dynamicSizing: [
    { minScore: 85, sol: 0.15 },
    { minScore: 75, sol: 0.10 },
    { minScore: 65, sol: 0.07 },
    { minScore: 55, sol: 0.03 },
  ],

  // ─── Strategy: Volume Explosion ───
  volumeExplosion: {
    emaShort: 9,
    emaLong: 21,
    volumeMultiplier: 3,
    rsiThreshold: 48,
    maxAgeMinutes: 45,
  },

  // ─── Strategy: RSI Divergence ───
  rsiDivergence: {
    rsiPeriod: 14,
    volumeMultiplier: 3.5,
    rsiOversold: 35,
  },

  // ─── Strategy: EMA Ribbon ───
  emaRibbon: {
    ribbon: [8, 13, 21, 34, 55],
    volumeMultiplier: 2.5,
    rsiMin: 45,
  },

  // ─── Strategy: VWAP Reversion ───
  vwapReversion: {
    volumeMultiplier: 3,
    rsiMax: 40,
    minAge: 10,
  },

  // ─── Strategy: Triple Momentum ───
  tripleMomentum: {
    emaShort: 9,
    emaLong: 21,
    emaTrend: 200,
    rsiBuy: 50,
    volumeMultiplier: 3.5,
    maxAgeMinutes: 60,
  },
};
