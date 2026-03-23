

# Plan: Ustawienie ruchomego Stop Loss na 20%

## Co się zmieni
Trailing stop table w `position-monitor` zostanie zaktualizowany — zamiast obecnych ciasnych wartości (2-5%), wszystkie poziomy będą miały trailing stop **20%**, co da tokenom znacznie więcej miejsca na wahania cenowe bez przedwczesnego zamknięcia.

## Zmiany techniczne

### 1. `supabase/functions/position-monitor/index.ts`
- Zmiana `TRAILING_TABLE` — ustawienie `trailing: 20` dla wszystkich tier-ów
- Zmiana domyślnego fallback w `getTrailingStopPct()` z `4` na `20`

Nowa tabela:
```
{ minPnl: 200, trailing: 20 },
{ minPnl: 100, trailing: 20 },
{ minPnl: 80, trailing: 20 },
{ minPnl: 40, trailing: 20 },
{ minPnl: 20, trailing: 20 },
{ minPnl: 10, trailing: 20 },
{ minPnl: 0, trailing: 20 },
```

### 2. `src/services/bot/config.ts`
- Analogiczna zmiana w tabeli `trailingTable` na frontendzie

### 3. Redeploy edge function

## Pliki do edycji
- `supabase/functions/position-monitor/index.ts` (linie 17-32)
- `src/services/bot/config.ts` (trailingTable)

