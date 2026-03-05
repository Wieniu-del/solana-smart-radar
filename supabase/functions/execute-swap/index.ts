import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Keypair, VersionedTransaction } from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_QUOTE_API = "https://lite-api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_API = "https://lite-api.jup.ag/swap/v1/swap";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, tokenMint, amountSol, slippageBps } = await req.json();

    if (!tokenMint || !amountSol || !action) {
      return new Response(JSON.stringify({ success: false, error: "Brak wymaganych parametrów" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const PRIVATE_KEY = Deno.env.get("SOLANA_PRIVATE_KEY");
    if (!PRIVATE_KEY) {
      return new Response(JSON.stringify({ success: false, error: "Brak klucza prywatnego portfela. Dodaj SOLANA_PRIVATE_KEY w ustawieniach Cloud." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine input/output mints based on action
    const inputMint = action === "BUY" ? SOL_MINT : tokenMint;
    const outputMint = action === "BUY" ? tokenMint : SOL_MINT;

    // Amount in lamports (1 SOL = 1e9 lamports)
    const amountLamports = Math.round(amountSol * 1e9);

    // 1. Get quote from Jupiter
    const quoteUrl = `${JUPITER_QUOTE_API}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps || 100}`;
    const quoteRes = await fetch(quoteUrl);
    
    if (!quoteRes.ok) {
      const quoteErr = await quoteRes.text();
      return new Response(JSON.stringify({ success: false, error: `Jupiter quote error: ${quoteErr}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const quoteData = await quoteRes.json();

    // Derive user public key from wallet secret
    const keyBytes = parsePrivateKey(PRIVATE_KEY);
    const signer = keyBytes.length === 32
      ? Keypair.fromSeed(keyBytes)
      : Keypair.fromSecretKey(keyBytes);
    const userPublicKey = signer.publicKey.toBase58();

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
      const swapErr = await swapRes.text();
      return new Response(JSON.stringify({ success: false, error: `Jupiter swap error: ${swapErr}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const swapData = await swapRes.json();
    const swapTransaction = swapData.swapTransaction;

    // 3. Deserialize, sign and send transaction
    const txBytes = Uint8Array.from(atob(swapTransaction), c => c.charCodeAt(0));

    // Sign using ed25519
    const { sign } = await import("https://deno.land/x/ed25519@1.6.0/mod.ts");
    const signature = sign(txBytes, keyBytes.slice(0, 32));

    // Send raw transaction to Solana RPC
    const HELIUS_KEY = Deno.env.get("HELIUS_API_KEY");
    const rpcUrl = HELIUS_KEY 
      ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
      : "https://api.mainnet-beta.solana.com";

    // Construct signed transaction
    // For versioned transactions, we need to insert the signature
    const signedTx = new Uint8Array(txBytes);
    // The first 64 bytes after the signature count are the signature slot
    const sigOffset = 1; // after compact-u16 signature count
    signedTx.set(signature, sigOffset);

    const sendRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [
          btoa(String.fromCharCode(...signedTx)),
          { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
        ],
      }),
    });

    const sendResult = await sendRes.json();

    if (sendResult.error) {
      return new Response(JSON.stringify({ success: false, error: `RPC error: ${sendResult.error.message}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      txSignature: sendResult.result,
      inputAmount: amountSol,
      outputAmount: quoteData.outAmount,
      priceImpact: quoteData.priceImpactPct,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Base58 decode/encode helpers
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
  const digits: number[] = [0];
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
