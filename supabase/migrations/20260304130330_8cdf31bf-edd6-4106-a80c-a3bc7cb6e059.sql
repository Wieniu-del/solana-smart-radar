
-- Table for tracking open positions with trailing stop-loss
CREATE TABLE public.open_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_mint text NOT NULL,
  token_symbol text,
  entry_price_usd numeric NOT NULL DEFAULT 0,
  current_price_usd numeric NOT NULL DEFAULT 0,
  highest_price_usd numeric NOT NULL DEFAULT 0,
  amount_sol numeric NOT NULL DEFAULT 0,
  token_amount numeric DEFAULT 0,
  trailing_stop_pct numeric NOT NULL DEFAULT 10,
  take_profit_pct numeric NOT NULL DEFAULT 50,
  stop_price_usd numeric DEFAULT 0,
  pnl_pct numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  signal_id uuid REFERENCES public.trading_signals(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  close_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.open_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_positions_allow_all" ON public.open_positions
  AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);

-- Enable realtime for position updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.open_positions;
