

# Plan: Zyskowna strategia + logika zarządzania kapitałem

## Analiza obecnych wyników (193 zamkniętych pozycji)

```text
Win rate:     42% (81/193)
Avg win:      +7.48%
Avg loss:     -15.58%
Total PnL:    -1139%

Główne przyczyny strat:
├── time_decay (66 trades, avg -0.70%) → wchodzenie w stagnujące tokeny
├── no_tokens (61 trades, avg -1.51%) → race condition closures  
├── dead_token (13 trades, avg -100%) → katastrofalne straty
├── stop_loss (17 trades, avg -11.55%) → za głęboki SL
└── trailing_stop (10 trades, avg +35.35%) → jedyny zyskowny typ!
```

**Diagnoza**: Bot wchodzi w zbyt wiele słabych pozycji. Stosunek zysk/strata jest odwrócony (avg win +7% vs avg loss -15%). Trzeba: mniej wejść, wyższa jakość, lepsze zarządzanie ryzykiem.

---

## Nowa strategia: "Quality Over Quantity"

### 1. Ostrzejsze kryteria wejścia (bot-monitor)

| Parametr | Było | Będzie | Powód |
|----------|------|--------|-------|
| buyThreshold | 45 | 60 | Odrzuca słabe sygnały |
| Wymagane TA strategie | 0 (defensive OK) | min. 1 | Bez TA = ślepe wejście |
| Min liquidity | $3,000 | $10,000 | Eliminuje dead tokens |
| Min volume 5m | $2,000 | $5,000 | Wymaga aktywnego rynku |
| Momentum m5 | > -10% | > +0.5% | Tylko rosnące tokeny |
| Momentum h1 | brak | > +2% | Trend godzinowy musi być pozytywny |

### 2. Adaptive Position Sizing (nowa logika)

Zamiast stałych rozmiarów — pozycja skalowana wg confidence:
```text
Score 85-100:  0.15 SOL  (high conviction)
Score 75-84:   0.10 SOL  (medium-high)
Score 65-74:   0.06 SOL  (medium)
Score 60-64:   0.03 SOL  (minimum — test position)
```

### 3. Tiered Trailing Stop (nowa logika zamiast flat 20%)

Trailing stop zacieśnia się w miarę wzrostu zysku — chroni zyski lepiej:
```text
PnL >100%:  trailing 15%  (chroni mega-winnery)
PnL >50%:   trailing 18%
PnL >20%:   trailing 20%
PnL >10%:   trailing 25%  (daje więcej przestrzeni na początku)
PnL 3-10%:  trailing 30%  (szeroki — pozwól rozwinąć się)
```

### 4. Circuit Breaker — ochrona kapitału

- **Max 3 consecutive losses** → pauza 30 minut
- **Max 5 strat dziennie** → stop na resztę dnia
- Logika w bot-monitor: sprawdzaj ostatnie pozycje przed wejściem

### 5. Anti-Dead-Token Shield

- Jeśli token ma **0 par na DexScreener** → natychmiast odrzuć
- Jeśli liquidity < $5,000 po wejściu → zamknij w 30 min (nie czekaj 3h)
- Mandatory price check: cena musi być > $0.0000001

### 6. Fee-Aware Filter

Przy typowym slippage + fee ~2% roundtrip, wejście ma sens tylko gdy oczekiwany ruch > 5%. Dodaj:
- Odrzuć jeśli ATR (Average True Range) 5m < 3% — token za mało się rusza

---

## Pliki do edycji

### `supabase/functions/bot-monitor/index.ts`
- Podnieść buyThreshold z 45 → 60
- Wymusić min. 1 TA strategy (usunąć defensive-only path do BUY)
- Momentum filter: m5 > +0.5% AND h1 > +2%
- Min liquidity $10k, min volume5m $5k
- Circuit breaker: sprawdź ostatnie 3-5 pozycji przed wejściem
- Nowe dynamic sizing

### `supabase/functions/position-monitor/index.ts`
- Tiered trailing stop (15-30% wg PnL)
- Szybsze zamykanie dead tokens (30min bez ceny zamiast 3h)
- Logowanie circuit breaker stats

### `src/services/bot/config.ts`
- Synchronizacja nowych parametrów z frontendem

### Migracja SQL
- UPDATE bot_config: nowe wartości buyThreshold, trailing, circuit breaker
- INSERT circuit_breaker config keys

---

## Oczekiwany efekt

```text
Przed:   193 trades, 42% win rate, avg win +7%, avg loss -15% → -1139% PnL
Cel:     ~50-70 trades/tydzień, 55%+ win rate, avg win +15%, avg loss -8%
         Mniej wejść, wyższa jakość, lepszy R/R ratio
```

