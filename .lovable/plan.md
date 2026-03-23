

# Plan: Otwarcie bota na cały rynek Solany

## Co się zmieni

Bot aktualnie **nie jest ograniczony do memecoinów** — skanuje trending, new pools i volume scanner. Jednak filtr **maksymalnego wieku tokena (720 minut = 12h)** powoduje, że bot odrzuca wszystkie ustabilizowane tokeny (DeFi, infra, gaming itp.). Dodatkowo volume scanner szuka tylko par zawierających "SOL" w nazwie.

## Zmiany techniczne

### 1. `supabase/functions/bot-monitor/index.ts`

**A. Usunięcie limitu wieku tokena (720 min)**
- Linia ~490: `tokenAgeMinutes > 720` → usunięcie tego filtra lub ustawienie na 999999
- Linia ~839 (discovery): analogicznie — usunięcie `tokenAgeMinutes > 720`
- Tokeny DeFi, infra, gaming mają miesiące/lata — ten filtr je blokuje

**B. Rozszerzenie Volume Scanner**
- Linia ~773: zamiast jednego zapytania `search?q=SOL`, dodać dodatkowe zapytania:
  - `search?q=solana` — szersze wyniki
  - Zwiększyć limit z 10 do 15 par z volume scannera

**C. Rozszerzenie limitu discovery**
- Linia ~806: zwiększyć `discProcessed >= 15` → `25` — więcej tokenów z rynku ogólnego

### 2. `src/services/bot/config.ts`
- `maxTokenAgeMinutes: 720` → `99999` — synchronizacja z frontendem

### Pliki do edycji
- `supabase/functions/bot-monitor/index.ts` (3-4 zmiany)
- `src/services/bot/config.ts` (1 zmiana)
- Redeploy edge function

