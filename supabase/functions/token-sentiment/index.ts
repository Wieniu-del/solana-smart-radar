const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tokenSymbol, tokenMint } = await req.json();

    if (!tokenSymbol && !tokenMint) {
      return jsonResponse({ success: false, error: "tokenSymbol or tokenMint required" }, 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return jsonResponse({ success: false, error: "AI not configured" }, 500);
    }

    const tokenId = tokenSymbol || tokenMint?.slice(0, 8);

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `Jesteś ekspertem od kryptowalut Solana. Analizujesz sentyment rynkowy wobec tokenów.
Na podstawie swojej wiedzy o tokenie, oceń aktualny sentyment rynkowy.
Odpowiedz WYŁĄCZNIE poprawnym JSON (bez markdown, bez bloków kodu) w formacie:
{
  "sentiment": "bullish" | "bearish" | "neutral",
  "confidence": 0-100,
  "summary": "krótkie podsumowanie po polsku (max 2 zdania)",
  "risk_factors": ["lista ryzyk"],
  "positive_factors": ["lista pozytywów"],
  "recommendation": "BUY" | "HOLD" | "AVOID",
  "sentiment_score": -100 to 100
}
Bądź obiektywny i krytyczny. Nie promuj tokenów. Uwzględnij: bezpieczeństwo projektu, aktywność zespołu, płynność, community, historię ceny.`
          },
          {
            role: "user",
            content: `Przeanalizuj sentyment rynkowy tokena: ${tokenId}${tokenMint ? ` (mint: ${tokenMint})` : ""}. Uwzględnij ogólną sytuację na rynku Solana.`
          }
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return jsonResponse({ success: false, error: "Rate limit - spróbuj ponownie za chwilę" }, 429);
      }
      if (aiResponse.status === 402) {
        return jsonResponse({ success: false, error: "Brak kredytów AI" }, 402);
      }
      return jsonResponse({ success: false, error: "AI request failed" }, 500);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content;

    if (!content) {
      return jsonResponse({ success: false, error: "Empty AI response" }, 500);
    }

    // Parse JSON from AI response
    let analysis;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      analysis = {
        sentiment: "neutral",
        confidence: 50,
        summary: content.slice(0, 200),
        risk_factors: [],
        positive_factors: [],
        recommendation: "HOLD",
        sentiment_score: 0,
      };
    }

    return jsonResponse({
      success: true,
      token: tokenId,
      analysis,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Sentiment error:", msg);
    return jsonResponse({ success: false, error: msg }, 500);
  }
});

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
