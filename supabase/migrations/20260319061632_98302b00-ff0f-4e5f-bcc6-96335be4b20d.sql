CREATE TABLE public.cached_token_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  tokens jsonb NOT NULL DEFAULT '[]'::jsonb,
  market_mood text,
  scan_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cached_token_discoveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cached_token_discoveries_allow_all" ON public.cached_token_discoveries
  FOR ALL TO public USING (true) WITH CHECK (true);

CREATE INDEX idx_cached_discoveries_category ON public.cached_token_discoveries(category, created_at DESC);