import { WalletAnalysis } from "./helius";

export interface SmartScoreBreakdown {
  total: number;
  activityScore: number;      // 0-25: based on tx frequency
  consistencyScore: number;   // 0-20: how regular across hours
  diversityScore: number;     // 0-20: token diversity
  volumeScore: number;        // 0-20: portfolio value
  recencyScore: number;       // 0-15: how recent last activity
  details: string[];
}

export function calculateSmartScore(analysis: WalletAnalysis): SmartScoreBreakdown {
  const details: string[] = [];

  // ── Activity Score (0-25) ──
  let activityScore = 0;
  if (analysis.tx24h >= 50) activityScore = 25;
  else if (analysis.tx24h >= 20) activityScore = 20;
  else if (analysis.tx24h >= 10) activityScore = 15;
  else if (analysis.tx24h >= 5) activityScore = 10;
  else if (analysis.tx24h >= 1) activityScore = 5;
  details.push(`Aktywność 24h: ${analysis.tx24h} TX → ${activityScore}/25 pkt`);

  // ── Consistency Score (0-20) ──
  const activeHours = analysis.hourlyActivity.filter((v) => v > 0).length;
  const consistencyScore = Math.round((activeHours / 24) * 20);
  details.push(`Regularność: ${activeHours}/24 godz. aktywnych → ${consistencyScore}/20 pkt`);

  // ── Diversity Score (0-20) ──
  const uniqueTokens = analysis.tokens.length;
  let diversityScore = 0;
  if (uniqueTokens >= 20) diversityScore = 20;
  else if (uniqueTokens >= 10) diversityScore = 15;
  else if (uniqueTokens >= 5) diversityScore = 10;
  else if (uniqueTokens >= 2) diversityScore = 5;
  details.push(`Dywersyfikacja: ${uniqueTokens} tokenów → ${diversityScore}/20 pkt`);

  // ── Volume Score (0-20) ──
  let volumeScore = 0;
  const vol = analysis.totalValueUsd;
  if (vol >= 100000) volumeScore = 20;
  else if (vol >= 10000) volumeScore = 15;
  else if (vol >= 1000) volumeScore = 10;
  else if (vol >= 100) volumeScore = 5;
  details.push(`Wartość portfela: $${vol.toFixed(2)} → ${volumeScore}/20 pkt`);

  // ── Recency Score (0-15) ──
  let recencyScore = 0;
  const now = Date.now() / 1000;
  const minutesAgo = (now - analysis.lastActivity) / 60;
  if (minutesAgo < 10) recencyScore = 15;
  else if (minutesAgo < 60) recencyScore = 12;
  else if (minutesAgo < 360) recencyScore = 8;
  else if (minutesAgo < 1440) recencyScore = 4;
  details.push(`Ostatnia aktywność: ${minutesAgo < 60 ? `${Math.round(minutesAgo)} min` : `${Math.round(minutesAgo / 60)} godz.`} temu → ${recencyScore}/15 pkt`);

  const total = activityScore + consistencyScore + diversityScore + volumeScore + recencyScore;

  return {
    total: Math.min(total, 100),
    activityScore,
    consistencyScore,
    diversityScore,
    volumeScore,
    recencyScore,
    details,
  };
}

export function getScoreStatus(score: number): "High Activity" | "Active" | "Moderate" | "Dormant" {
  if (score > 70) return "High Activity";
  if (score > 40) return "Active";
  if (score > 20) return "Moderate";
  return "Dormant";
}
