-- Trading signals table
CREATE TABLE public.trading_signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  token_symbol TEXT,
  token_name TEXT,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('BUY', 'SELL')),
  strategy TEXT NOT NULL,
  smart_score NUMERIC,
  risk_score NUMERIC,
  confidence NUMERIC NOT NULL DEFAULT 0,
  conditions JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'executed', 'rejected', 'expired')),
  executed_at TIMESTAMP WITH TIME ZONE,
  tx_signature TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Trading strategies config
CREATE TABLE public.trading_strategies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('BUY', 'SELL')),
  conditions JSONB NOT NULL DEFAULT '{}',
  max_position_sol NUMERIC NOT NULL DEFAULT 0.1,
  stop_loss_pct NUMERIC DEFAULT 20,
  take_profit_pct NUMERIC DEFAULT 50,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Execution history
CREATE TABLE public.trade_executions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id UUID REFERENCES public.trading_signals(id),
  strategy_id UUID REFERENCES public.trading_strategies(id),
  token_mint TEXT NOT NULL,
  token_symbol TEXT,
  action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL')),
  amount_sol NUMERIC NOT NULL,
  token_amount NUMERIC,
  price_usd NUMERIC,
  tx_signature TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.trading_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_executions ENABLE ROW LEVEL SECURITY;

-- Public read/write for now (no auth yet)
CREATE POLICY "Allow all on trading_signals" ON public.trading_signals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on trading_strategies" ON public.trading_strategies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on trade_executions" ON public.trade_executions FOR ALL USING (true) WITH CHECK (true);

-- Insert default strategies
INSERT INTO public.trading_strategies (name, description, signal_type, conditions, max_position_sol, enabled) VALUES
('Smart Money Follow', 'Kup token gdy portfel z Smart Score > 70 go kupuje', 'BUY', '{"min_smart_score": 70, "min_liquidity_usd": 1000, "max_risk_score": 40}', 0.1, false),
('Rugpull Exit', 'Sprzedaj gdy token dostaje status Critical w analizie bezpieczeństwa', 'SELL', '{"min_risk_score": 60}', 0, false),
('Whale Alert Buy', 'Kup gdy wieloryb (portfel > $100k) kupuje nowy token', 'BUY', '{"min_portfolio_usd": 100000, "min_liquidity_usd": 5000, "max_risk_score": 30}', 0.05, false),
('Smart Money Exit', 'Sprzedaj gdy smart wallet wychodzi z pozycji', 'SELL', '{"min_smart_score": 60, "sell_threshold_pct": 50}', 0, false);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_trading_strategies_updated_at
  BEFORE UPDATE ON public.trading_strategies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();