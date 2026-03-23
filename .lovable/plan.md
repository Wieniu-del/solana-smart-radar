

# Plan: Włączenie kupna i naprawienie usterek

## Aktualny stan systemu
Po przejrzeniu kodu, baza danych i edge functions — oto co jest do zrobienia:

## 1. Włączenie kupna (sell_only_mode → false)
- Zmiana wartości `sell_only_mode` na `false` w tabeli `bot_config`
- Bot natychmiast wróci do normalnego trybu BUY + SELL

## 2. Naprawa znanych usterek

### A. PnL dla trailing_stop/max_hold_time — nierealistyczne wartości
Audyt z ostatniego sprawdzenia systemu wykazał, że pozycje zamknięte przez `trailing_stop` pokazują absurdalne zyski (np. +83,449%). Problem: gdy `highest_price_usd` zostaje ustawiona na błędną wartość (z braku aktualizacji ceny), PnL jest kalkulowany nieprawidłowo.
- **Fix**: Dodać cap na PnL w `position-monitor` — ograniczyć maksymalny zapisywany PnL do 500% (realistyczny limit dla mikro-tokenów)
- Skorygować historyczne rekordy z PnL > 500% w bazie

### B. Profit Fade i Mini Profit Take — zbyt agresywne zamykanie
Obecne ustawienia zamykają pozycje zbyt wcześnie:
- `profit_fade`: zamyka gdy zysk spadł z >3% do <1% — to zbyt wąski margines
- `mini_profit_take`: zamyka po 30min przy >2% — to zbyt niski próg
- **Fix**: Podnieść progi: profit_fade z 3%→8%, mini_profit_take z 2%→5% i czas z 30min→60min

### C. Time Decay 45 min — za krótki
Bot zamyka pozycje po 45 minutach jeśli zysk <5%. Na agresywnym rynku to za wcześnie.
- **Fix**: Zwiększyć time_decay z 45min na 90min, i próg z 5% na 8%

### D. Korekta historycznych danych PnL
- UPDATE pozycji z PnL > 500% na cap 500%
- UPDATE pozycji z PnL < -100% na -100% (minimum)

## 3. Pliki do edycji
- `supabase/functions/position-monitor/index.ts` — poprawki PnL cap, progi zamykania
- Tabela `bot_config` — sell_only_mode = false
- Tabela `open_positions` — korekta historycznych danych

## Kolejność
1. Naprawić position-monitor (cap PnL, lepsze progi)
2. Skorygować historię w bazie
3. Włączyć kupno (sell_only_mode = false)

