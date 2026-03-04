
-- Fix: policies are RESTRICTIVE, need to be PERMISSIVE
-- Drop all and recreate as PERMISSIVE (default)

DROP POLICY IF EXISTS "Allow all on bot_config" ON public.bot_config;
CREATE POLICY "bot_config_allow_all" ON public.bot_config AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on bot_runs" ON public.bot_runs;
CREATE POLICY "bot_runs_allow_all" ON public.bot_runs AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on notifications" ON public.notifications;
CREATE POLICY "notifications_allow_all" ON public.notifications AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on trade_executions" ON public.trade_executions;
CREATE POLICY "trade_executions_allow_all" ON public.trade_executions AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on trading_signals" ON public.trading_signals;
CREATE POLICY "trading_signals_allow_all" ON public.trading_signals AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on trading_strategies" ON public.trading_strategies;
CREATE POLICY "trading_strategies_allow_all" ON public.trading_strategies AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
