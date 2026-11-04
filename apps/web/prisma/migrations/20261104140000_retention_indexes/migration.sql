-- #726: indexes for the global retention sweeps.
--
-- ADDITIVE ONLY. These indexes serve the `WHERE recordedAt < cutoff` and
-- `WHERE sentAt < cutoff` scans used by lib/retention.ts. The existing
-- (deviceId, recordedAt) indexes serve per-device charts, not a global cutoff.
-- No data is deleted or changed by this migration.

CREATE INDEX IF NOT EXISTS "WaterTempLog_recordedAt_idx"
  ON "WaterTempLog"("recordedAt");

CREATE INDEX IF NOT EXISTS "FeedLevelLog_recordedAt_idx"
  ON "FeedLevelLog"("recordedAt");

CREATE INDEX IF NOT EXISTS "ReminderLog_sentAt_idx"
  ON "ReminderLog"("sentAt");
