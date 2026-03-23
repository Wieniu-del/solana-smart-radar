

# Plan: Obniżenie PnL cap z 500% do 100%

## Zmiana
1. **position-monitor/index.ts** — linia 600: zmiana `Math.min(pnlPct, 500)` → `Math.min(pnlPct, 100)`
2. **Korekta historycznych danych** — SQL UPDATE: cap wszystkich pozycji z `pnl_pct > 100` na `100`

## Pliki do edycji
- `supabase/functions/position-monitor/index.ts` (1 linia)
- Migracja SQL na tabeli `open_positions`

