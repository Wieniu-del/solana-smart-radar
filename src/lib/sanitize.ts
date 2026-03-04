/**
 * Security utilities — input sanitization and validation
 */

// Validate Solana address (Base58, 32-44 chars)
export function sanitizeSolanaAddress(input: string): string | null {
  const trimmed = input.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) return null;
  return trimmed;
}

// Sanitize generic text input (prevent XSS)
export function sanitizeText(input: string, maxLength = 500): string {
  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[<>"'&]/g, (c) => {
      const map: Record<string, string> = { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '&': '&amp;' };
      return map[c] || c;
    });
}

// Validate API key format (hex + hyphens only)
export function sanitizeApiKey(input: string): string | null {
  const clean = input.trim().replace(/[^a-f0-9-]/gi, '');
  if (clean.length < 10 || clean.length > 128) return null;
  return clean;
}

// Rate limiter for client-side API calls
const callTimestamps = new Map<string, number[]>();

export function isRateLimited(key: string, maxCalls: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = callTimestamps.get(key) || [];
  const recent = timestamps.filter((t) => now - t < windowMs);
  if (recent.length >= maxCalls) return true;
  recent.push(now);
  callTimestamps.set(key, recent);
  return false;
}

// Mask sensitive data for display
export function maskSecret(value: string, visibleChars = 4): string {
  if (value.length <= visibleChars * 2) return '•'.repeat(value.length);
  return value.slice(0, visibleChars) + '•'.repeat(Math.max(4, value.length - visibleChars * 2)) + value.slice(-visibleChars);
}

// Validate URL (prevent SSRF-like attacks on client)
export function isValidUrl(url: string, allowedDomains?: string[]): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (allowedDomains && !allowedDomains.some(d => parsed.hostname.endsWith(d))) return false;
    return true;
  } catch {
    return false;
  }
}
