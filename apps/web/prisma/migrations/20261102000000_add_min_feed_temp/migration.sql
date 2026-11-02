-- Issue #486: a warn-only minimum water temperature before feeding.
-- Additive nullable column; no backfill. Null means the pond has not set one,
-- and the dashboard stays silent instead of guessing a safe temperature.
ALTER TABLE "EnergyDevice" ADD COLUMN "minFeedTempC" DOUBLE PRECISION;
