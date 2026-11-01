-- Issue #454: persist the latest firmware diagnostic object per device.
-- Additive nullable column; no backfill needed (devices stay null until the
-- next heartbeat carries a diag object).
ALTER TABLE "EnergyDevice" ADD COLUMN "diag" JSONB;
