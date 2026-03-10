UPDATE open_positions SET trailing_stop_pct = 7, take_profit_pct = 12 WHERE status = 'open';
UPDATE trading_strategies SET stop_loss_pct = 7, take_profit_pct = 12;
UPDATE bot_config SET value = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            value::jsonb,
            '{risk_manager,take_profit_pct}', '12'
          ),
          '{risk_manager,trailing_stop_pct}', '7'
        ),
        '{scoring,buy_threshold}', '78'
      ),
      '{auto_execute,min_confidence}', '80'
    ),
    '{liquidity_check,min_value_usd}', '30000'
  ),
  '{wallet_analysis,min_wallet_value_usd}', '30000'
) WHERE key = 'pipeline_config';