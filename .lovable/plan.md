

# Plan: Trailing Stop jako jedyny egzekutor zysku

## Obecny stan
Nie ma klasycznego TP, ale dwa mechanizmy działają jak ukryte Take Profit:
- **Profit Fade** (linia 123): zamyka gdy zysk spadł z >8% do <3%
- **Mini Profit Take** (linia 132): zamyka po 60min przy zysku 5-15%

Te dwa mechanizmy przedwcześnie zamykają pozycje zamiast pozwolić trailing stopowi pracować.

## Co się zmieni
1. **Usunięcie profit_fade** — trailing stop 20% i tak zamknie pozycję jeśli cena spadnie 20% od szczytu
2. **Usunięcie mini_profit_take** — trailing stop powinien sam zarządzać zyskiem, nie arbitralny timer
3. **Zachowanie**: stop loss (-15%), fast loss cut (-4% w 20min), time decay (90min <8%), trailing stop 20%

## Logika po zmianach
- Pozycja na minusie → stop loss / fast loss cut
- Pozycja stagnuje → time decay po 90min
- Pozycja rośnie → trailing stop 20% od szczytu zamyka gdy cena się cofnie
- Mega-winner (>100%) → trailing stop bez limitu czasowego

## Plik do edycji
- `supabase/functions/position-monitor/index.ts` — usunięcie bloków profit_fade (linie 121-128) i mini_profit_take (linie 130-137)
- Redeploy edge function

