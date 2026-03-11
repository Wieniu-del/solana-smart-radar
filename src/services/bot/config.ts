export const config = {
  volumeExplosion: {
    emaShort: 9,
    emaLong: 21,
    volumeMultiplier: 2.5,
    rsiThreshold: 45,
    maxAgeMinutes: 45,
  },
  rsiDivergence: {
    rsiPeriod: 14,
    volumeMultiplier: 2.5,
    rsiOversold: 40,
  },
  emaRibbon: {
    ribbon: [8, 13, 21, 34, 55],
    volumeMultiplier: 2,
    rsiMin: 40,
  },
  vwapReversion: {
    volumeMultiplier: 2,
    rsiMax: 45,
    minAge: 10,
  },
  tripleMomentum: {
    emaShort: 9,
    emaLong: 21,
    emaTrend: 50,
    rsiBuy: 48,
    volumeMultiplier: 3,
    maxAgeMinutes: 60,
  },
};
