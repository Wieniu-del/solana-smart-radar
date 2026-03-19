export const config = {
  // ─── SNIPER BOT SETTINGS (AGGRESSIVE) ───
  scanInterval: 15,            // seconds — ultra-fast scan cycle
  maxOpenPositions: 5,         // more positions = more opportunities
  minPositionSol: 0.03,
  maxPositionSol: 0.20,
  maxPositionTotal: 1.0,       // SOL total across all positions

  // ─── SNIPER RISK MANAGEMENT (AGGRESSIVE) ───
  stopLossPct: 20,             // wider stop — let trades breathe
  takeProfitPct: 999,          // TP disabled — trailing stop manages
  trailingStartPct: 3,         // lock gains very early

  // Trailing Stop Table (pnlPct → trailingPct)
  trailingTable: [
    { minPnl: 200, trailing: 8 },
    { minPnl: 100, trailing: 6 },
    { minPnl: 80, trailing: 4 },
    { minPnl: 40, trailing: 3 },
    { minPnl: 20, trailing: 3.5 },
    { minPnl: 10, trailing: 4 },
    { minPnl: 0, trailing: 5 },
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

  // ─── SNIPER MARKET FILTERS (AGGRESSIVE) ───
  minLiquidityUsd: 3000,       // lowered from 10k — catch early plays
  minVolume5m: 2000,           // lowered from 10k — more signals
  maxTokenAgeMinutes: 720,     // 12 hours — way wider window
  maxSingleHolderPct: 30,      // relaxed from 20
  mintAuthority: false,
  freezeAuthority: false,

  // ─── Volume Confirmation ───
  volumeConfirmation: {
    enabled: true,
    consecutiveRisingCandles: 2, // lowered from 3
  },

  // ─── Smart Wallet Analysis ───
  smartWalletsTracked: 10,
  minWalletValueUsd: 20,       // lowered from 50
  minConfidence: 50,           // lowered from 70 — let more through
  smartWalletBonus: 15,        // increased from 10

  // ─── SNIPER SCORING (AGGRESSIVE) ───
  buyScoreThreshold: 45,       // lowered from 65 — much more aggressive
  minScoreForPosition: 45,

  // Dynamic sizing based on score
  dynamicSizing: [
    { minScore: 85, sol: 0.20 },
    { minScore: 75, sol: 0.15 },
    { minScore: 65, sol: 0.12 },
    { minScore: 55, sol: 0.08 },
    { minScore: 45, sol: 0.05 },
  ],

  // ─── SNIPER ENTRY (AGGRESSIVE) ───
  sniperMode: {
    instantThreshold: 70,      // lowered from 80 — instant at 70+
    fastDelay: 1,              // 1 min instead of 2
    normalDelay: 2,            // 2 min instead of 3
    signalExpiry: 60,          // 60 min instead of 30
  },

  // ─── Strategy: Volume Explosion ───
  volumeExplosion: {
    emaShort: 9,
    emaLong: 21,
    volumeMultiplier: 1.8,     // lowered from 2.5
    rsiThreshold: 35,          // lowered from 45
    maxAgeMinutes: 60,         // expanded from 30
  },

  // ─── Strategy: RSI Divergence ───
  rsiDivergence: {
    rsiPeriod: 14,
    volumeMultiplier: 2.5,     // lowered from 3.5
    rsiOversold: 40,           // raised from 35 (easier trigger)
  },

  // ─── Strategy: EMA Ribbon ───
  emaRibbon: {
    ribbon: [8, 13, 21, 34, 55],
    volumeMultiplier: 1.8,     // lowered from 2.5
    rsiMin: 38,                // lowered from 45
  },

  // ─── Strategy: VWAP Reversion ───
  vwapReversion: {
    volumeMultiplier: 2,       // lowered from 3
    rsiMax: 45,                // raised from 40
    minAge: 5,                 // lowered from 10
  },

  // ─── Strategy: Triple Momentum ───
  tripleMomentum: {
    emaShort: 9,
    emaLong: 21,
    emaTrend: 50,
    rsiBuy: 40,                // lowered from 48
    volumeMultiplier: 2,       // lowered from 3
    maxAgeMinutes: 60,         // expanded from 30
  },
};
