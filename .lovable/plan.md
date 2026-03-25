

# Diagnoza: Dlaczego bot nie handluje

## Wykryte problemy (3 krytyczne)

### Problem 1: DexScreener zwraca $0 liquidity dla prawie wszystkich tokenów
Logi pokazują setki odrzuceń typu `REJECT: liquidity $0 < $10000`. DexScreener API prawdopodobnie limituje zapytania (rate limiting) lub zmienił format odpowiedzi. Nawet Jupiter fallback nie pomaga — co oznacza, że tokeny są odrzucane zanim dostaną szansę na ocenę.

### Problem 2: Błędne koło TA ↔ Liquidity
Kod na linii 587: TA strategies uruchamiają się TYLKO gdy `realLiquidityUsd > 0`. Ale skoro liquidity = $0, TA nigdy nie działa → `taTriggered` zawsze puste → Quality Gate v4 odrzuca WSZYSTKO. W ostatnich 24h: **361 rejected, 328 expired, tylko 2 executed**.

### Problem 3: Wszystkie SELL-e failują (error 0x1788)
Ostatnie 10 trade_executions to same SELL failures z błędem `custom program error: 0x1788` (Jupiter insufficient balance/slippage). Bot nie może zamknąć żadnej pozycji.

```text
Przepływ problemu:
Token → DexScreener = $0 liq → REJECT (min $10k)
                                   ↓ (nawet jeśli przejdzie)
                            TA wymaga liq > 0 → TA nie odpala
                                   ↓
                          Quality Gate: no TA → SKIP
                                   ↓
                         Bot: 0 nowych pozycji
```

## Plan naprawy

### 1. Naprawić pobieranie liquidity (bot-monitor)
- Dodać **Birdeye API** jako dodatkowy fallback (endpoint: `https://public-api.birdeye.so/defi/token_overview`)
- Dodać retry z delay 1s na DexScreener (rate limit protection)
- Jeśli DexScreener + Birdeye + Jupiter = $0, ale token jest na Jupiter (ma cenę) → estymuj liquidity na **$15k** zamiast odrzucać

### 2. Usunąć błędne koło TA ↔ Liquidity
- Zmienić warunek z `realLiquidityUsd > 0` na `enabledTAStrategies.length > 0` — pozwolić TA oceniać tokeny niezależnie od danych o płynności
- Quality Gate: dodać trzecią ścieżkę — jeśli token ma cenę na Jupiter i score >= 65, przepuść bez TA

### 3. Naprawić SELL (error 0x1788)
- Zwiększyć slippage na SELL z 300 bps (3%) do **500 bps (5%)**
- Dodać retry z mniejszą kwotą (90% balance) jeśli pierwszy SELL failuje
- Dla micro-cap tokenów: użyć `autoSlippage: true` w Jupiter API

### 4. Dodać monitoring DexScreener health
- Logować success rate DexScreener API (ile razy zwraca dane vs $0)
- Alert jeśli > 90% zapytań zwraca $0 (oznacza rate limit)

## Pliki do edycji

| Plik | Zmiana |
|------|--------|
| `supabase/functions/bot-monitor/index.ts` | Birdeye fallback, retry DexScreener, usunięcie warunku `liq > 0` dla TA, trzecia ścieżka Quality Gate |
| `supabase/functions/execute-swap/index.ts` | Wyższy slippage na SELL, retry z 90% balance |
| `supabase/functions/position-monitor/index.ts` | Przekazywanie wyższego slippage przy SELL calls |

## Oczekiwany efekt

```text
Przed:  361 rejected / 24h, 0 otwartych pozycji, 100% SELL fail
Po:     Tokeny z Jupiter price przechodzą filtry, TA ocenia bez blokady,
        SELL z 5% slippage powinien przechodzić dla większości tokenów
```

