// Helius API Service for Solana blockchain data
import { supabase } from "@/integrations/supabase/client";

const HELIUS_BASE = "https://api.helius.xyz/v0";
const HELIUS_RPC = "https://mainnet.helius-rpc.com";

let _cachedKey: string | null = null;
let _fetchingKey: Promise<string | null> | null = null;

export function getHeliusApiKey(): string | null {
  // Check memory cache first, then localStorage
  if (_cachedKey) return _cachedKey;
  const stored = localStorage.getItem("helius_api_key");
  if (stored) {
    _cachedKey = stored;
    return stored;
  }
  return null;
}

/**
 * Auto-fetch Helius API key from Cloud secrets and store locally.
 * Called once on app startup.
 */
export async function initHeliusApiKey(): Promise<string | null> {
  // Already have key
  const existing = getHeliusApiKey();
  if (existing) return existing;

  // Prevent duplicate fetches
  if (_fetchingKey) return _fetchingKey;

  _fetchingKey = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("get-helius-key");
      if (error || !data?.key) return null;
      const key = data.key as string;
      localStorage.setItem("helius_api_key", key);
      _cachedKey = key;
      // Notify other components (TopBar, BlockchainStatus)
      window.dispatchEvent(new Event("helius-key-updated"));
      return key;
    } catch {
      return null;
    } finally {
      _fetchingKey = null;
    }
  })();

  return _fetchingKey;
}

export function setHeliusApiKey(key: string) {
  let clean = key.trim();

  const urlMatch = clean.match(/api-key=([a-f0-9-]+)/i);
  if (urlMatch) {
    clean = urlMatch[1];
  } else {
    const eqIndex = clean.lastIndexOf("=");
    if (eqIndex !== -1 && eqIndex < clean.length - 1) {
      clean = clean.substring(eqIndex + 1).trim();
    }
  }

  // Strict sanitization: only hex + hyphens
  clean = clean.replace(/[^a-f0-9-]/gi, "");

  if (clean.length < 10 || clean.length > 128) {
    console.warn("Helius key invalid length after cleaning:", clean.length);
    return;
  }

  localStorage.setItem("helius_api_key", clean);
  _cachedKey = clean;
  window.dispatchEvent(new Event("helius-key-updated"));
}

export async function validateHeliusKey(key: string): Promise<boolean> {
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBlockHeight" }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return !!json.result;
  } catch {
    return false;
  }
}

function requireKey(): string {
  const key = getHeliusApiKey();
  if (!key) throw new Error("Brak klucza Helius API. Dodaj go w Ustawieniach.");
  return key;
}

// Validate Solana address — regex + Base58 decode to 32 bytes
export function isValidSolanaAddress(address: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
  try {
    const decoded = decodeBase58(address);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

function decodeBase58(str: string): Uint8Array {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes: number[] = [];
  for (const c of str) {
    let carry = ALPHABET.indexOf(c);
    if (carry < 0) throw new Error("Invalid base58 character");
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const c of str) {
    if (c !== "1") break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

// ─── Wallet Transactions ───
export interface HeliusTransaction {
  signature: string;
  timestamp: number;
  type: string;
  fee: number;
  feePayer: string;
  description: string;
  source: string;
  tokenTransfers: {
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
    mint: string;
    tokenName?: string;
    tokenSymbol?: string;
  }[];
  nativeTransfers: {
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }[];
}

export async function getTransactionHistory(address: string, limit = 50): Promise<HeliusTransaction[]> {
  if (!isValidSolanaAddress(address)) {
    throw new Error("Nieprawidłowy adres Solana — upewnij się, że wklejasz pełny adres portfela (32-44 znaki Base58).");
  }
  const key = requireKey();
  const res = await fetch(`${HELIUS_BASE}/addresses/${address}/transactions?api-key=${key}&limit=${limit}`);
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 400 || text.includes("invalid address")) {
      throw new Error("Podany adres portfela jest nieprawidłowy. Sprawdź, czy wkleiłeś pełny adres Solana.");
    }
    throw new Error(`Helius API error (${res.status}): ${text}`);
  }
  return res.json();
}

// ─── Token Balances ───
export interface HeliusTokenBalance {
  mint: string;
  amount: number;
  decimals: number;
  tokenAccount: string;
  name?: string;
  symbol?: string;
  logoURI?: string;
  priceUsd?: number;
  valueUsd?: number;
}

export async function getTokenBalances(address: string): Promise<HeliusTokenBalance[]> {
  if (!isValidSolanaAddress(address)) {
    throw new Error("Nieprawidłowy adres Solana.");
  }
  const key = requireKey();
  const res = await fetch(`${HELIUS_RPC}/?api-key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAssetsByOwner",
      params: {
        ownerAddress: address,
        displayOptions: { showFungible: true, showNativeBalance: true },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Helius RPC error (${res.status}): ${text}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(`Nieprawidłowy adres portfela: ${json.error.message || "Weryfikacja adresu nie powiodła się"}`);
  }
  const items = json.result?.items || [];
  const nativeBalance = json.result?.nativeBalance;

  const tokens: HeliusTokenBalance[] = [];

  // Add native SOL
  if (nativeBalance) {
    tokens.push({
      mint: "So11111111111111111111111111111111111111112",
      amount: nativeBalance.lamports / 1e9,
      decimals: 9,
      tokenAccount: address,
      name: "Solana",
      symbol: "SOL",
      logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
      priceUsd: nativeBalance.price_per_sol || 0,
      valueUsd: (nativeBalance.lamports / 1e9) * (nativeBalance.price_per_sol || 0),
    });
  }

  for (const item of items) {
    if (item.interface === "FungibleToken" || item.interface === "FungibleAsset") {
      const info = item.token_info || {};
      const meta = item.content?.metadata || {};
      const amount = (info.balance || 0) / Math.pow(10, info.decimals || 0);
      if (amount <= 0) continue;
      tokens.push({
        mint: item.id,
        amount,
        decimals: info.decimals || 0,
        tokenAccount: item.id,
        name: meta.name || "Unknown",
        symbol: info.symbol || meta.symbol || "???",
        logoURI: item.content?.links?.image || item.content?.files?.[0]?.uri || undefined,
        priceUsd: info.price_info?.price_per_token || 0,
        valueUsd: amount * (info.price_info?.price_per_token || 0),
      });
    }
  }

  // Sort by USD value descending
  tokens.sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));
  return tokens;
}

// ─── Parsed Swaps / Trades ───
export interface ParsedTrade {
  signature: string;
  timestamp: number;
  type: "BUY" | "SELL" | "SWAP" | "TRANSFER";
  source: string;
  description: string;
  tokenIn?: { symbol: string; amount: number; mint: string };
  tokenOut?: { symbol: string; amount: number; mint: string };
  fee: number;
}

export function parseTradesFromHistory(txns: HeliusTransaction[], walletAddress: string): ParsedTrade[] {
  return txns
    .filter((tx) => tx.tokenTransfers.length > 0 || tx.type === "SWAP" || tx.type === "TRANSFER")
    .map((tx) => {
      const outgoing = tx.tokenTransfers.find((t) => t.fromUserAccount === walletAddress);
      const incoming = tx.tokenTransfers.find((t) => t.toUserAccount === walletAddress);

      let type: ParsedTrade["type"] = "TRANSFER";
      if (tx.type === "SWAP" || (outgoing && incoming)) type = "SWAP";
      else if (incoming && !outgoing) type = "BUY";
      else if (outgoing && !incoming) type = "SELL";

      return {
        signature: tx.signature,
        timestamp: tx.timestamp,
        type,
        source: tx.source || "unknown",
        description: tx.description || "",
        tokenIn: outgoing
          ? { symbol: outgoing.tokenSymbol || "???", amount: outgoing.tokenAmount, mint: outgoing.mint }
          : undefined,
        tokenOut: incoming
          ? { symbol: incoming.tokenSymbol || "???", amount: incoming.tokenAmount, mint: incoming.mint }
          : undefined,
        fee: tx.fee,
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}

// ─── Full Wallet Analysis ───
export interface WalletAnalysis {
  address: string;
  tokens: HeliusTokenBalance[];
  transactions: HeliusTransaction[];
  trades: ParsedTrade[];
  totalValueUsd: number;
  txCount: number;
  tx24h: number;
  lastActivity: number;
  hourlyActivity: number[];
}

export async function analyzeWallet(address: string): Promise<WalletAnalysis> {
  const [tokens, transactions] = await Promise.all([
    getTokenBalances(address),
    getTransactionHistory(address, 100),
  ]);

  const trades = parseTradesFromHistory(transactions, address);
  const totalValueUsd = tokens.reduce((sum, t) => sum + (t.valueUsd || 0), 0);

  const now = Date.now() / 1000;
  const oneDayAgo = now - 86400;
  const tx24h = transactions.filter((t) => t.timestamp > oneDayAgo).length;
  const lastActivity = transactions.length > 0 ? transactions[0].timestamp : 0;

  // Build hourly activity for last 24h
  const hourlyActivity = new Array(24).fill(0);
  for (const tx of transactions) {
    if (tx.timestamp > oneDayAgo) {
      const hour = new Date(tx.timestamp * 1000).getHours();
      hourlyActivity[hour]++;
    }
  }

  return {
    address,
    tokens,
    transactions,
    trades,
    totalValueUsd,
    txCount: transactions.length,
    tx24h,
    lastActivity,
    hourlyActivity,
  };
}
