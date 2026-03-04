
-- Drop restrictive policies and recreate as permissive
DROP POLICY IF EXISTS "Allow all on bot_config" ON public.bot_config;
CREATE POLICY "Allow all on bot_config" ON public.bot_config FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on bot_runs" ON public.bot_runs;
CREATE POLICY "Allow all on bot_runs" ON public.bot_runs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on notifications" ON public.notifications;
CREATE POLICY "Allow all on notifications" ON public.notifications FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on trade_executions" ON public.trade_executions;
CREATE POLICY "Allow all on trade_executions" ON public.trade_executions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on trading_signals" ON public.trading_signals;
CREATE POLICY "Allow all on trading_signals" ON public.trading_signals FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on trading_strategies" ON public.trading_strategies;
CREATE POLICY "Allow all on trading_strategies" ON public.trading_strategies FOR ALL USING (true) WITH CHECK (true);
