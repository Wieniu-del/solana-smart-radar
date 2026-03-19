import nacl from "https://esm.sh/tweetnacl@1.0.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_QUOTE_API = "https://lite-api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_API = "https://lite-api.jup.ag/swap/v1/swap";
const CONFIRMATION_RETRIES = 12;
const CONFIRMATION_INTERVAL_MS = 1500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, tokenMint, amountSol, slippageBps, closeAll } = await req.json();

    if (!tokenMint || !action) {
      return jsonRes({ success: false, error: "Brak wymaganych parametrów" }, 400);
    }

    const PRIVATE_KEY = Deno.env.get("SOLANA_PRIVATE_KEY");
    if (!PRIVATE_KEY) {
      return jsonRes({ success: false, error: "Brak klucza prywatnego. Dodaj SOLANA_PRIVATE_KEY." }, 500);
    }

    const HELIUS_KEY = Deno.env.get("HELIUS_API_KEY");
    const rpcUrl = HELIUS_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
      : "https://api.mainnet-beta.solana.com";

    const keyBytes = parsePrivateKey(PRIVATE_KEY);
    let keypair: { publicKey: Uint8Array; secretKey: Uint8Array };
    if (keyBytes.length === 32) {
      keypair = nacl.sign.keyPair.fromSeed(keyBytes);
    } else if (keyBytes.length === 64) {
      keypair = nacl.sign.keyPair.fromSecretKey(keyBytes);
    } else {
      return jsonRes({ success: false, error: `Invalid key length: ${keyBytes.length}` }, 500);
    }
    const userPublicKey = encodeBase58(keypair.publicKey);
    console.log(`[execute-swap] Wallet: ${userPublicKey.slice(0, 8)}...`);

    const inputMint = action === "BUY" ? SOL_MINT : tokenMint;
    const outputMint = action === "BUY" ? tokenMint : SOL_MINT;

    let amountLamports = 0;
    let tokenDecimals = 0;
    let walletTokenRawBefore = 0;

    if (action === "BUY") {
      if (!amountSol || Number(amountSol) <= 0) {
        return jsonRes({ success: false, error: "Nieprawidłowa kwota BUY" }, 400);
      }
      amountLamports = Math.round(Number(amountSol) * 1e9);
    } else {
      tokenDecimals = await fetchTokenDecimals(rpcUrl, tokenMint);
      walletTokenRawBefore = await fetchWalletTokenBalanceBaseUnits(rpcUrl, userPublicKey, tokenMint);
      const requestedRaw = amountSol && Number(amountSol) > 0
        ? Math.floor(Number(amountSol) * Math.pow(10, tokenDecimals))
        : 0;

      amountLamports = closeAll === true
        ? walletTokenRawBefore
        : (requestedRaw > 0 ? Math.min(requestedRaw, walletTokenRawBefore) : walletTokenRawBefore);

      if (amountLamports <= 0) {
        return jsonRes({ success: false, error: `Brak tokenów ${tokenMint.slice(0, 6)}... do sprzedaży` }, 400);
      }

      console.log(`[execute-swap] SELL amount raw=${amountLamports}, decimals=${tokenDecimals}, closeAll=${closeAll === true}`);
    }

    const quoteUrl = `${JUPITER_QUOTE_API}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps || 300}`;
    console.log(`[execute-swap] ${action} quote request`);
    const quoteRes = await fetch(quoteUrl);
    if (!quoteRes.ok) {
      const err = await quoteRes.text();
      return jsonRes({ success: false, error: `Jupiter quote error: ${err}` }, 502);
    }
    const quoteData = await quoteRes.json();

    const swapRes = await fetch(JUPITER_SWAP_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quoteData,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    });
    if (!swapRes.ok) {
      const err = await swapRes.text();
      return jsonRes({ success: false, error: `Jupiter swap error: ${err}` }, 502);
    }
    const swapData = await swapRes.json();
    const swapTransaction = swapData.swapTransaction;
    if (!swapTransaction) {
      return jsonRes({ success: false, error: "Brak transakcji swap z Jupiter" }, 502);
    }

    const txBytes = Uint8Array.from(atob(swapTransaction), (c) => c.charCodeAt(0));
    const numSigs = txBytes[0];
    const sigsEnd = 1 + numSigs * 64;
    const messageBytes = txBytes.slice(sigsEnd);
    const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
    const signedTx = new Uint8Array(txBytes.length);
    signedTx.set(txBytes);
    signedTx.set(signature, 1);

    let b64 = "";
    const chunk = 8192;
    for (let i = 0; i < signedTx.length; i += chunk) {
      b64 += String.fromCharCode(...signedTx.slice(i, i + chunk));
    }
    b64 = btoa(b64);

    const sendRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [b64, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }],
      }),
    });

    const sendResult = await sendRes.json();
    if (sendResult.error) {
      return jsonRes({ success: false, error: `RPC error: ${sendResult.error.message}` }, 502);
    }

    const txSignature = sendResult.result as string;
    const confirmation = await confirmTransaction(rpcUrl, txSignature);
    if (!confirmation.success) {
      return jsonRes({ success: false, error: confirmation.error || "Transakcja nie została potwierdzona" }, 502);
    }

    let remainingRawBalance: number | undefined;
    let soldRawAmount: number | undefined;
    if (action === "SELL") {
      remainingRawBalance = await fetchWalletTokenBalanceBaseUnits(rpcUrl, userPublicKey, tokenMint);
      soldRawAmount = Math.max(0, walletTokenRawBefore - remainingRawBalance);

      if (closeAll === true) {
        const dustThresholdRaw = Math.max(1, Math.floor(Math.pow(10, Math.max(tokenDecimals - 4, 0))));
        if (remainingRawBalance > dustThresholdRaw) {
          return jsonRes({
            success: false,
            error: `Po sprzedaży na portfelu nadal zostały tokeny (${remainingRawBalance} raw units)`,
            txSignature,
            remainingRawBalance,
          }, 409);
        }
      }
    }

    console.log(`[execute-swap] ✅ TX confirmed: ${txSignature}`);
    return jsonRes({
      success: true,
      txSignature,
      inputAmount: action === "BUY" ? Number(amountSol) : undefined,
      outputAmount: quoteData.outAmount,
      priceImpact: quoteData.priceImpactPct,
      tokenDecimals: action === "SELL" ? tokenDecimals : undefined,
      soldRawAmount,
      remainingRawBalance,
    });
  } catch (err: any) {
    console.error("[execute-swap] Error:", err);
    return jsonRes({ success: false, error: err.message }, 500);
  }
});

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

function encodeBase58(bytes: Uint8Array): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let str = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    str += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    str += ALPHABET[digits[i]];
  }
  return str;
}

async function fetchTokenDecimals(rpcUrl: string, mint: string): Promise<number> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenSupply",
        params: [mint],
      }),
    });
    const data = await res.json();
    const decimals = Number(data?.result?.value?.decimals);
    return Number.isFinite(decimals) ? decimals : 6;
  } catch {
    return 6;
  }
}

async function fetchWalletTokenBalanceBaseUnits(rpcUrl: string, owner: string, mint: string): Promise<number> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          owner,
          { mint },
          { encoding: "jsonParsed" },
        ],
      }),
    });

    const data = await res.json();
    const accounts = data?.result?.value || [];

    return accounts.reduce((sum: number, acc: any) => {
      const rawAmount = Number(acc?.account?.data?.parsed?.info?.tokenAmount?.amount || 0);
      return sum + (Number.isFinite(rawAmount) ? rawAmount : 0);
    }, 0);
  } catch {
    return 0;
  }
}

async function confirmTransaction(rpcUrl: string, signature: string): Promise<{ success: boolean; error?: string }> {
  for (let attempt = 0; attempt < CONFIRMATION_RETRIES; attempt++) {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignatureStatuses",
        params: [[signature], { searchTransactionHistory: true }],
      }),
    });

    const data = await res.json();
    const status = data?.result?.value?.[0];

    if (status?.err) {
      return { success: false, error: `Transakcja odrzucona: ${JSON.stringify(status.err)}` };
    }

    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return { success: true };
    }

    await delay(CONFIRMATION_INTERVAL_MS);
  }

  return { success: false, error: "Timeout potwierdzenia transakcji" };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePrivateKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("Invalid key format");
    return new Uint8Array(parsed);
  }
  return decodeBase58(trimmed);
}
