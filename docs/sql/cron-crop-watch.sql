-- ============================================================
-- Phase 4 — crop-watch cron (harvest + sampling reminders)
-- pg_cron runs SQL only; pg_net makes the HTTP call to the app.
--
-- HUMAN STEP: run this file ONCE by hand, per environment.
--   1. Replace YOUR_APP_URL with the deployment origin
--      (e.g. https://your-app.vercel.app) — NO trailing /en/.
--   2. Store the secret in Supabase Vault instead of plain SQL:
--        SELECT vault.create_secret('YOUR_CRON_SECRET', 'crop_watch_secret');
--      The endpoint compares against the CRON_SECRET env var in Vercel,
--      so use the same value in both places (see apps/web/.env.example).
--   3. Schedule it (22:00 UTC = 06:00 Asia/Manila, once daily).
--
-- This file must never contain a real URL or secret.
-- ============================================================

-- One-time: extensions (Supabase projects usually have pg_cron available;
-- pg_net must be enabled in Database → Extensions).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- One-time: the schedule. Comment out any previous run first:
-- SELECT cron.unschedule('crop-watch');

SELECT cron.schedule(
  'crop-watch',
  '0 22 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://YOUR_APP_URL/api/cron/crop-watch',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || vault.decrypted_secret('crop_watch_secret')
    ),
    timeout_milliseconds := 8000
  ) AS request_id;
  $$
);

-- Verify:
-- SELECT * FROM cron.job;
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
--
-- A rerun of the route is safe: ReminderLog.dedupeKey is unique, so the same
-- occurrence/channel is never inserted twice. Failed emails are retried on the
-- next daily run, up to 3 attempts.
