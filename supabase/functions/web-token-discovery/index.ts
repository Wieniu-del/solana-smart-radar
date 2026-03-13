import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'AI not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const category = body.category || 'community';
    const limit = body.limit || 10;

    const prompts: Record<string, string> = {
      community: `Find the most trending community/meme tokens on Solana blockchain right now. 
Focus on tokens that are gaining social media traction on Twitter/X, Reddit, Telegram, and Discord.
Look for: new community tokens, viral meme coins, tokens with growing holder counts, tokens mentioned by influencers.`,
      defi: `Find the hottest new DeFi tokens and protocols launching on Solana right now.
Focus on: new DEX tokens, lending protocols, yield farming opportunities, liquid staking tokens.`,
      nft: `Find Solana NFT-related tokens and projects gaining momentum right now.
Focus on: NFT collection tokens, NFT marketplace tokens, gaming tokens with NFT integration.`,
      trending: `Find the absolute hottest and most viral Solana tokens trending right now across all categories.
Include memecoins, community tokens, new launches with high volume, and any token going viral on social media.`,
    };

    const selectedPrompt = prompts[category] || prompts.community;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `Jesteś ekspertem od ekosystemu Solana i analityk trendów krypto. Przeszukujesz internet, media społecznościowe (Twitter/X, Reddit, Telegram, Discord) i platformy DeFi w poszukiwaniu gorących tokenów.

Odpowiedz WYŁĄCZNIE poprawnym JSON (bez markdown, bez bloków kodu) w formacie:
{
  "tokens": [
    {
      "name": "Nazwa tokena",
      "symbol": "SYMBOL",
      "mint": "adres mint jeśli znany, inaczej null",
      "category": "meme|community|defi|nft|gaming",
      "social_score": 1-100,
      "description": "Krótki opis po polsku - co to za token i dlaczego jest gorący",
      "sources": ["Twitter", "Reddit", "Telegram"],
      "sentiment": "bullish|bearish|neutral",
      "risk_level": "low|medium|high|extreme",
      "trend_direction": "up|down|stable",
      "estimated_volume_24h": "$X",
      "holder_growth": "rosnąca|stabilna|spadająca",
      "why_trending": "Powód popularności po polsku"
    }
  ],
  "market_mood": "bullish|bearish|neutral",
  "scan_summary": "Podsumowanie skanowania po polsku"
}

Generuj ${limit} tokenów. Bądź precyzyjny, realistyczny i aktualny. Skup się na tokenach z REALNYM traction w mediach społecznościowych.`
          },
          {
            role: 'user',
            content: selectedPrompt
          }
        ],
        temperature: 0.8,
        max_tokens: 4000,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('AI error:', errText);

      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limit - spróbuj ponownie za chwilę' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'Brak kredytów AI - doładuj konto' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: false, error: 'AI request failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      console.error('Failed to parse AI response:', content);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid AI response format' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Optionally save discovered tokens to notifications for bot awareness
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (parsed.tokens && parsed.tokens.length > 0) {
      const topTokens = parsed.tokens
        .filter((t: any) => t.social_score >= 70 && t.sentiment === 'bullish')
        .slice(0, 3);

      for (const token of topTokens) {
        await supabase.from('notifications').insert({
          title: `🔥 Trending: ${token.name} (${token.symbol})`,
          message: `${token.why_trending} | Social: ${token.social_score}/100 | Risk: ${token.risk_level}`,
          type: 'discovery',
          details: { token, source: 'web-discovery', category },
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, ...parsed, scanned_at: new Date().toISOString() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Web token discovery error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
