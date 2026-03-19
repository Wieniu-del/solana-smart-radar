export const config = {
  // ─── SNIPER BOT SETTINGS ───
  scanInterval: 30,          // seconds — fast scan cycle
  maxOpenPositions: 3,
  minPositionSol: 0.05,      // raised from 0.03 — if entering, commit
  maxPositionSol: 0.15,
  maxPositionTotal: 0.45,    // SOL total across all positions

  // ─── SNIPER RISK MANAGEMENT ───
  stopLossPct: 12,           // tightened from 15% — cut losers faster
  takeProfitPct: 999,        // TP disabled — trailing stop manages
  trailingStartPct: 5,       // lowered from 8% — lock gains earlier

  // Trailing Stop Table (pnlPct → trailingPct)
  trailingTable: [
    { minPnl: 200, trailing: 5 },   // mega-winner: wide trailing
    { minPnl: 100, trailing: 4 },
    { minPnl: 80, trailing: 2 },
    { minPnl: 40, trailing: 2.5 },
    { minPnl: 20, trailing: 3 },
    { minPnl: 10, trailing: 3.5 },
    { minPnl: 0, trailing: 4 },
  ],

  // ─── Loss Protection (DISABLED) ───
  cooldown: {
    enabled: false,
    maxConsecutiveLosses: 999,
    cooldownMinutes: 0,
  },
  dailyLossLimit: {
    enabled: false,
    maxDailyLossSol: 999,
  },

  // ─── SNIPER MARKET FILTERS ───
  minLiquidityUsd: 10000,
  minVolume5m: 10000,        // lowered from 25k — TA confirmation compensates
  maxTokenAgeMinutes: 120,
  maxSingleHolderPct: 20,
  mintAuthority: false,
  freezeAuthority: false,

  // ─── Volume Confirmation ───
  volumeConfirmation: {
    enabled: true,
    consecutiveRisingCandles: 3,
  },

  // ─── Smart Wallet Analysis ───
  smartWalletsTracked: 8,
  minWalletValueUsd: 50,
  minConfidence: 70,         // raised from 75 → 70 (pipeline already filters at 70)
  smartWalletBonus: 10,

  // ─── SNIPER SCORING ───
  buyScoreThreshold: 65,     // raised from 50 — quality over quantity
  minScoreForPosition: 65,

  // Dynamic sizing based on score (sniper: more aggressive at top)
  dynamicSizing: [
    { minScore: 90, sol: 0.15 },
    { minScore: 80, sol: 0.12 },
    { minScore: 75, sol: 0.10 },
    { minScore: 70, sol: 0.07 },
    { minScore: 65, sol: 0.05 },
  ],

  // ─── SNIPER ENTRY ───
  sniperMode: {
    instantThreshold: 80,    // confidence >=80 = no delay
    fastDelay: 2,            // minutes for medium confidence
    normalDelay: 3,           // minutes for lower confidence
    signalExpiry: 30,         // minutes — stale signals die fast
  },

  // ─── Strategy: Volume Explosion ───
  volumeExplosion: {
    emaShort: 9,
    emaLong: 21,
    volumeMultiplier: 2.5,
    rsiThreshold: 45,
    maxAgeMinutes: 30,
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
    emaTrend: 50,
    rsiBuy: 48,
    volumeMultiplier: 3,
    maxAgeMinutes: 30,
  },
};
