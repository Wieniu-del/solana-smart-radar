import nacl from "https://esm.sh/tweetnacl@1.0.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_QUOTE_API = "https://lite-api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_API = "https://lite-api.jup.ag/swap/v1/swap";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, tokenMint, amountSol, slippageBps } = await req.json();

    if (!tokenMint || !amountSol || !action) {
      return jsonRes({ success: false, error: "Brak wymaganych parametrów" }, 400);
    }

    const PRIVATE_KEY = Deno.env.get("SOLANA_PRIVATE_KEY");
    if (!PRIVATE_KEY) {
      return jsonRes({ success: false, error: "Brak klucza prywatnego. Dodaj SOLANA_PRIVATE_KEY." }, 500);
    }

    const inputMint = action === "BUY" ? SOL_MINT : tokenMint;
    const outputMint = action === "BUY" ? tokenMint : SOL_MINT;
    const amountLamports = Math.round(amountSol * 1e9);

    // 1. Get quote
    const quoteUrl = `${JUPITER_QUOTE_API}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps || 300}`;
    console.log(`[execute-swap] ${action} quote request`);
    const quoteRes = await fetch(quoteUrl);
    if (!quoteRes.ok) {
      const err = await quoteRes.text();
      return jsonRes({ success: false, error: `Jupiter quote error: ${err}` }, 502);
    }
    const quoteData = await quoteRes.json();

    // 2. Derive keypair
    const keyBytes = parsePrivateKey(PRIVATE_KEY);
    let keypair: nacl.SignKeyPair;
    if (keyBytes.length === 32) {
      keypair = nacl.sign.keyPair.fromSeed(keyBytes);
    } else if (keyBytes.length === 64) {
      keypair = nacl.sign.keyPair.fromSecretKey(keyBytes);
    } else {
      return jsonRes({ success: false, error: `Invalid key length: ${keyBytes.length}` }, 500);
    }
    const userPublicKey = encodeBase58(keypair.publicKey);
    console.log(`[execute-swap] Wallet: ${userPublicKey.slice(0, 8)}...`);

    // 3. Get swap transaction
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

    // 4. Deserialize, sign, send
    const txBytes = Uint8Array.from(atob(swapTransaction), c => c.charCodeAt(0));

    // Versioned tx: [num_sigs(1 byte)] [sig_slots(num_sigs * 64)] [message...]
    const numSigs = txBytes[0];
    const sigsEnd = 1 + numSigs * 64;
    const messageBytes = txBytes.slice(sigsEnd);

    // Sign message with ed25519
    const signature = nacl.sign.detached(messageBytes, keypair.secretKey);

    // Inject signature into first slot
    const signedTx = new Uint8Array(txBytes.length);
    signedTx.set(txBytes);
    signedTx.set(signature, 1);

    const HELIUS_KEY = Deno.env.get("HELIUS_API_KEY");
    const rpcUrl = HELIUS_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
      : "https://api.mainnet-beta.solana.com";

    // Convert to base64
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
        jsonrpc: "2.0", id: 1,
        method: "sendTransaction",
        params: [b64, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }],
      }),
    });

    const sendResult = await sendRes.json();
    if (sendResult.error) {
      return jsonRes({ success: false, error: `RPC error: ${sendResult.error.message}` }, 502);
    }

    console.log(`[execute-swap] ✅ TX: ${sendResult.result}`);
    return jsonRes({
      success: true,
      txSignature: sendResult.result,
      inputAmount: amountSol,
      outputAmount: quoteData.outAmount,
      priceImpact: quoteData.priceImpactPct,
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

function parsePrivateKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("Invalid key format");
    return new Uint8Array(parsed);
  }
  return decodeBase58(trimmed);
}
