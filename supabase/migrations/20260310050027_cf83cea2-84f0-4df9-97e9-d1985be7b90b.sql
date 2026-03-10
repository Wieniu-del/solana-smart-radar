UPDATE open_positions SET take_profit_pct = 25 WHERE status = 'open';
UPDATE bot_config SET value = jsonb_set(value::jsonb, '{risk_manager,take_profit_pct}', '25') WHERE key = 'pipeline_config';
UPDATE trading_strategies SET take_profit_pct = 25 WHERE take_profit_pct = 40 OR take_profit_pct IS NULL;