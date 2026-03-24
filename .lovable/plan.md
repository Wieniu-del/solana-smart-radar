

# Plan: ✅ WDROŻONO — Quality Over Quantity Strategy

## Zmiany wdrożone

### 1. Ostrzejsze kryteria wejścia
- buyThreshold: 45 → **60**
- Min liquidity: $3k → **$10k**
- Min volume 5m: $2k → **$5k**
- Momentum: wymaga m5 > +0.5% LUB h1 > +2%
- Quality Gate v4: wymaga min. 1 TA strategy (defensive bar podniesiony do $50k + pozytywny momentum)

### 2. Tiered Trailing Stop (zamiast flat 20%)
- PnL >100%: trailing **15%** (chroni mega-winnery)
- PnL >50%: trailing **18%**
- PnL >20%: trailing **20%**
- PnL >10%: trailing **25%**
- PnL 3-10%: trailing **30%** (szeroki — pozwól rozwinąć się)

### 3. Adaptive Position Sizing (konserwatywy)
- Score 85+: 0.15 SOL
- Score 75-84: 0.10 SOL
- Score 65-74: 0.06 SOL
- Score 60-64: 0.03 SOL (test position)

### 4. Circuit Breaker
- 3 consecutive losses → 30 min pauza
- 5 strat dziennie → stop na resztę dnia

### 5. Anti-Dead-Token Shield
- Dead token timeout: 3h → **30 min**

### 6. Edge Functions deployed ✅
