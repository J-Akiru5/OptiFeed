-- Issue #415: compute the hopper capacity from the tank geometry instead of
-- asking for a guessed gram figure.
--
-- Additive only: two nullable columns on EnergyDevice, no default, no data
-- rewrite. Existing rows keep hopperCapacityG and read the new columns as
-- null, so every current capacity and daily-cap calculation is unchanged
-- until an operator saves a diameter.

ALTER TABLE "EnergyDevice"
    ADD COLUMN IF NOT EXISTS "hopperDiameterCm" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "hopperBulkDensityGCm3" DOUBLE PRECISION;
