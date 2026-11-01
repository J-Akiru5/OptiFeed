-- Label the origin of hopper level, water temperature and feed rows.
--
-- Real device telemetry reads "device". Rows an administrator writes or
-- adjusts by hand to cover a period the device was not reporting carry a
-- different value, so exports and audits can always tell them apart. The
-- label stays in the database and the backup export; no screen reads it.
--
-- Additive only: one text column per table with a constant default. Every
-- existing row reads "device"; nothing is rewritten.

ALTER TABLE "FeedLevelLog" ADD COLUMN IF NOT EXISTS "dataSource" TEXT NOT NULL DEFAULT 'device';
ALTER TABLE "WaterTempLog" ADD COLUMN IF NOT EXISTS "dataSource" TEXT NOT NULL DEFAULT 'device';
ALTER TABLE "FeedEvent" ADD COLUMN IF NOT EXISTS "dataSource" TEXT NOT NULL DEFAULT 'device';
