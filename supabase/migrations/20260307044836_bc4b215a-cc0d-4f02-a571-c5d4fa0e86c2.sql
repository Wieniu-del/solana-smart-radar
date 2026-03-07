
-- Prevent duplicate positions for same token+status in future
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_position_per_token 
ON open_positions (token_mint, status) 
WHERE status = 'open';
