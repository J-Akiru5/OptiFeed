-- ============================================================
-- Task 3.1 — device-watch cron (dead-device alerts)
-- pg_cron runs SQL only; pg_net makes the HTTP call to the app.
--
-- HUMAN STEP (H10): run this file ONCE by hand, per environment.
--   1. Replace YOUR_APP_URL with the deployment origin
--      (e.g. https://your-app.vercel.app) — NO trailing /en/.
--   2. Store the secret in Supabase Vault instead of plain SQL:
--        SELECT vault.create_secret('YOUR_CRON_SECRET', 'device_watch_secret');
--      The endpoint compares against the CRON_SECRET env var in Vercel,
--      so use the same value in both places (see apps/web/.env.example).
--   3. Schedule it (every 5 minutes; Hobby-safe, handler is batched).
--
-- This file must never contain a real URL or secret. (H10, H4)
--
-- Fixed 2026-11-01: the routes export GET only, so the call is net.http_get (not http_post)
-- and Supabase Vault has no vault.decrypted_secret(name) function, so the
-- header reads the secret from the vault.decrypted_secrets view instead.
-- ============================================================

-- One-time: extensions (Supabase projects usually have pg_cron available;
-- pg_net must be enabled in Database → Extensions).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- One-time: the schedule. Comment out any previous run first:
-- SELECT cron.unschedule('device-watch');

SELECT cron.schedule(
  'device-watch',
  '*/5 * * * *',
  $$
  SELECT net.http_get(
    url     := 'https://YOUR_APP_URL/api/cron/device-watch',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'device_watch_secret')
    ),
    timeout_milliseconds := 8000
  ) AS request_id;
  $$
);

-- Verify:
-- SELECT * FROM cron.job;
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
