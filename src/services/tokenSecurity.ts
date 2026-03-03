// Token Security Analysis — rugpull risk scoring
import { HeliusTokenBalance } from "./helius";

export interface TokenSecurityReport {
  mint: string;
  symbol: string;
  name: string;
  riskLevel: "safe" | "low" | "medium" | "high" | "critical";
  riskScore: number; // 0-100, higher = more risky
  flags: SecurityFlag[];
  details: string;
}

export interface SecurityFlag {
  type: "info" | "warning" | "danger";
  label: string;
  description: string;
}

// Known safe tokens (top Solana ecosystem)
const KNOWN_SAFE_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",  // JUP
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", // ETH (Wormhole)
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",  // mSOL
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", // stSOL
  "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", // PYTH
  "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof",  // RENDER
  "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",  // JTO
  "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux",  // HNT
  "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ", // W
]);

// Known DEX program IDs
const KNOWN_DEXES = [
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Orca
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP", // Raydium
];

export function analyzeTokenSecurity(token: HeliusTokenBalance): TokenSecurityReport {
  const flags: SecurityFlag[] = [];
  let riskScore = 0;

  // 1. Known safe token check
  if (KNOWN_SAFE_MINTS.has(token.mint)) {
    return {
      mint: token.mint,
      symbol: token.symbol || "???",
      name: token.name || "Unknown",
      riskLevel: "safe",
      riskScore: 0,
      flags: [{ type: "info", label: "Zweryfikowany", description: "Token z top ekosystemu Solana" }],
      details: "Token rozpoznany jako bezpieczny i zweryfikowany.",
    };
  }

  // 2. No name or symbol
  if (!token.name || token.name === "Unknown") {
    riskScore += 20;
    flags.push({ type: "warning", label: "Brak nazwy", description: "Token nie ma zweryfikowanej nazwy — może być fałszywy" });
  }
  if (!token.symbol || token.symbol === "???") {
    riskScore += 15;
    flags.push({ type: "warning", label: "Brak symbolu", description: "Token nie ma symbolu — niska wiarygodność" });
  }

  // 3. No logo
  if (!token.logoURI) {
    riskScore += 10;
    flags.push({ type: "info", label: "Brak logo", description: "Brak oficjalnego logo — token może być nowy lub niezweryfikowany" });
  }

  // 4. Very low price (potential scam / dust attack)
  if (token.priceUsd !== undefined && token.priceUsd > 0 && token.priceUsd < 0.000001) {
    riskScore += 15;
    flags.push({ type: "warning", label: "Mikro cena", description: `Cena $${token.priceUsd.toExponential(2)} — typowe dla dust attack lub scam tokenów` });
  }

  // 5. Very low value (dust)
  if ((token.valueUsd || 0) < 0.01 && token.amount > 0) {
    riskScore += 10;
    flags.push({ type: "info", label: "Dust token", description: "Wartość poniżej $0.01 — może być airdrop scam" });
  }

  // 6. No price data at all
  if (!token.priceUsd || token.priceUsd === 0) {
    riskScore += 20;
    flags.push({ type: "danger", label: "Brak wyceny", description: "Token nie ma żadnej wyceny rynkowej — brak płynności lub potencjalny rugpull" });
  }

  // 7. Extremely large supply held (suspicious if user holds tons)
  if (token.amount > 1e12) {
    riskScore += 15;
    flags.push({ type: "warning", label: "Ogromna ilość", description: "Posiadacz ma ponad 1 bilion tokenów — typowe dla scam airdropów" });
  }

  // 8. Low decimals (0-2) can indicate non-standard token
  if (token.decimals <= 2 && token.decimals >= 0) {
    riskScore += 5;
    flags.push({ type: "info", label: "Niskie decimals", description: `Token ma tylko ${token.decimals} miejsc(a) po przecinku` });
  }

  // Determine risk level
  let riskLevel: TokenSecurityReport["riskLevel"];
  if (riskScore >= 60) riskLevel = "critical";
  else if (riskScore >= 40) riskLevel = "high";
  else if (riskScore >= 25) riskLevel = "medium";
  else if (riskScore >= 10) riskLevel = "low";
  else riskLevel = "safe";

  const details = riskScore >= 40
    ? "⚠️ Wysoki wskaźnik ryzyka — token może być niebezpieczny (rugpull, scam, dust attack)."
    : riskScore >= 20
    ? "Token wymaga dodatkowej weryfikacji przed interakcją."
    : "Brak poważnych sygnałów ostrzegawczych.";

  return {
    mint: token.mint,
    symbol: token.symbol || "???",
    name: token.name || "Unknown",
    riskLevel,
    riskScore: Math.min(riskScore, 100),
    flags,
    details,
  };
}

export function analyzeAllTokens(tokens: HeliusTokenBalance[]): TokenSecurityReport[] {
  return tokens
    .map(analyzeTokenSecurity)
    .sort((a, b) => b.riskScore - a.riskScore);
}

export function getRiskColor(level: TokenSecurityReport["riskLevel"]): string {
  switch (level) {
    case "safe": return "text-primary";
    case "low": return "text-primary";
    case "medium": return "text-neon-amber";
    case "high": return "text-neon-red";
    case "critical": return "text-destructive";
  }
}

export function getRiskBgColor(level: TokenSecurityReport["riskLevel"]): string {
  switch (level) {
    case "safe": return "bg-primary/10 border-primary/30";
    case "low": return "bg-primary/5 border-primary/20";
    case "medium": return "bg-neon-amber/10 border-neon-amber/30";
    case "high": return "bg-neon-red/10 border-neon-red/30";
    case "critical": return "bg-destructive/10 border-destructive/30";
  }
}

export function getRiskLabel(level: TokenSecurityReport["riskLevel"]): string {
  switch (level) {
    case "safe": return "Bezpieczny";
    case "low": return "Niskie ryzyko";
    case "medium": return "Średnie ryzyko";
    case "high": return "Wysokie ryzyko";
    case "critical": return "KRYTYCZNE";
  }
}
