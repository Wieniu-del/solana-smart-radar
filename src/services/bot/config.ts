export const config = {
  volumeExplosion: {
    emaShort: 9,
    emaLong: 21,
    volumeMultiplier: 4,
    rsiThreshold: 50,
    maxAgeMinutes: 30,
  },
  rsiDivergence: {
    rsiPeriod: 14,
    volumeMultiplier: 3.5,
    rsiOversold: 35,
  },
  emaRibbon: {
    ribbon: [8, 13, 21, 34, 55],
    volumeMultiplier: 2.5,
    rsiMin: 45,
  },
  vwapReversion: {
    volumeMultiplier: 3,
    rsiMax: 40,
    minAge: 15,
  },
  tripleMomentum: {
    emaShort: 9,
    emaLong: 21,
    emaTrend: 200,
    rsiBuy: 55,
    volumeMultiplier: 5,
    maxAgeMinutes: 45,
  },
};
