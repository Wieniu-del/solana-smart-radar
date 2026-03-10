-- Fix dead tokens that incorrectly show 0% PnL — they should be -100%
UPDATE open_positions 
SET pnl_pct = -100 
WHERE status = 'closed' 
  AND close_reason = 'dead_token' 
  AND (pnl_pct = 0 OR pnl_pct IS NULL);