-- ============================================================
-- Background jobs worker — pg_cron + pg_net
--
-- Runs the queued export/import jobs. Every minute is enough for the
-- dashboard's polling UX; the worker claims with FOR UPDATE SKIP LOCKED,
-- so overlapping runs are safe.
--
-- HUMAN STEP (run ONCE per environment):
--   1. Replace YOUR_APP_URL with the deployment origin (no trailing slash).
--   2. Store the secret in Supabase Vault:
--        SELECT vault.create_secret('YOUR_CRON_SECRET', 'jobs_worker_secret');
--      Use the same value as the CRON_SECRET env var in Vercel.
--   3. Run this file.
--
-- This file must never contain a real URL or secret.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Comment out any previous schedule before re-running:
-- SELECT cron.unschedule('background-jobs');

SELECT cron.schedule(
  'background-jobs',
  '* * * * *',
  $$
  SELECT net.http_get(
    url     := 'https://YOUR_APP_URL/api/cron/jobs?max=5',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || vault.decrypted_secret('jobs_worker_secret')
    ),
    timeout_milliseconds := 15000
  ) AS request_id;
  $$
);

-- Verify:
-- SELECT * FROM cron.job;
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
