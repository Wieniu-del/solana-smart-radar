
-- Force close stale positions blocking new trades
UPDATE open_positions SET status = 'closed', close_reason = 'manual_cleanup', closed_at = now(), updated_at = now() WHERE status = 'open';

-- Increase max positions to 5
UPDATE bot_config SET value = '5'::jsonb WHERE key = 'max_open_positions';

-- Add stablecoins to a blacklist config
INSERT INTO bot_config (key, value) VALUES ('blacklisted_mints', '["USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB","EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
