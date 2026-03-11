export const config = {
  // ─── General Bot Settings ───
  scanInterval: 30,          // seconds
  maxOpenPositions: 3,
  minPositionSol: 0.03,
  maxPositionSol: 0.15,
  maxPositionTotal: 0.45,    // SOL total across all positions

  // ─── Risk Management ───
  stopLossPct: 15,           // -15% hard stop loss (was -22%)
  takeProfitPct: 999,        // TP disabled
  trailingStartPct: 8,       // trailing activates at +8% profit (was 25%)

  // Trailing Stop Table (pnlPct → trailingPct)
  trailingTable: [
    { minPnl: 80, trailing: 2 },
    { minPnl: 40, trailing: 2.5 },
    { minPnl: 20, trailing: 3 },
    { minPnl: 10, trailing: 3.5 },
    { minPnl: 0, trailing: 4 },
  ],

  // ─── Loss Protection ───
  cooldown: {
    enabled: true,
    maxConsecutiveLosses: 2,    // pause after 2 losses in a row
    cooldownMinutes: 10,        // wait 10 minutes
  },
  dailyLossLimit: {
    enabled: true,
    maxDailyLossSol: 0.1,      // stop buying if daily loss > 0.1 SOL
  },

  // ─── Market Filters ───
  minLiquidityUsd: 30000,      // was 15000
  minVolume5m: 40000,          // was 20000
  maxTokenAgeMinutes: 30,      // was 60
  maxSingleHolderPct: 20,
  mintAuthority: false,
  freezeAuthority: false,

  // ─── Volume Confirmation ───
  volumeConfirmation: {
    enabled: true,
    consecutiveRisingCandles: 3, // require 3 rising volume candles
  },

  // ─── Smart Wallet Analysis ───
  smartWalletsTracked: 8,
  minWalletValueUsd: 50,
  minConfidence: 75,
  smartWalletBonus: 10,

  // ─── Scoring ───
  buyScoreThreshold: 70,       // was 60
  minScoreForPosition: 70,     // was 65

  // Dynamic sizing based on score
  dynamicSizing: [
    { minScore: 85, sol: 0.15 },
    { minScore: 75, sol: 0.10 },
    { minScore: 70, sol: 0.07 },
    { minScore: 60, sol: 0.03 },
  ],

  // ─── Strategy: Volume Explosion ───
  volumeExplosion: {
    emaShort: 9,
    emaLong: 21,
    volumeMultiplier: 2.5,     // was 3
    rsiThreshold: 45,          // was 48
    maxAgeMinutes: 30,         // was 45
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
    emaTrend: 50,              // was 200
    rsiBuy: 48,                // was 50
    volumeMultiplier: 3,       // was 3.5
    maxAgeMinutes: 30,         // was 60
  },
};
