
-- Bot configuration table (tracked wallets, settings)
CREATE TABLE public.bot_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on bot_config" ON public.bot_config
  FOR ALL USING (true) WITH CHECK (true);

-- Bot run history (track every execution)
CREATE TABLE public.bot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  wallets_scanned int DEFAULT 0,
  tokens_found int DEFAULT 0,
  signals_generated int DEFAULT 0,
  buy_signals int DEFAULT 0,
  error_message text,
  duration_ms int,
  details jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.bot_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on bot_runs" ON public.bot_runs
  FOR ALL USING (true) WITH CHECK (true);

-- Insert default bot config
INSERT INTO public.bot_config (key, value) VALUES
  ('bot_enabled', 'false'::jsonb),
  ('tracked_wallets', '[]'::jsonb),
  ('scan_interval_minutes', '1'::jsonb),
  ('max_position_sol', '0.1'::jsonb),
  ('min_score_threshold', '70'::jsonb);
