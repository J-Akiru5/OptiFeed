-- Issue #659: the hopper filter tuning was firmware-only, so a bouncing or
-- noisy ultrasonic sensor could only be adapted with a new build.
--
-- ADDITIVE ONLY: seven nullable columns on "EnergyDevice"; no existing column,
-- constraint, policy or row is touched, and there is no backfill. NULL keeps
-- the firmware's compile-time value (the row simply overlays nothing onto the
-- poll response), so every device keeps its current behaviour until an operator
-- writes a value on the device settings page.
--
-- The envelopes live in `firmware/firmware-main/config.h` (`FW_CONFIG_FIELDS`)
-- and are mirrored by the app's `FIRMWARE_FIELDS` table; the columns carry no
-- database CHECK because the firmware is the authority and refuses the whole
-- config object when a value leaves the envelope.
--
-- Generated with:
--   prisma migrate diff --from-schema-datamodel <previous> \
--     --to-schema-datamodel prisma/schema.prisma --script
-- AlterTable
ALTER TABLE "EnergyDevice" ADD COLUMN     "hopperEmaAlpha" DOUBLE PRECISION,
ADD COLUMN     "hopperJumpPct" DOUBLE PRECISION,
ADD COLUMN     "hopperPersistCycles" INTEGER,
ADD COLUMN     "hopperRefillMarginPct" DOUBLE PRECISION,
ADD COLUMN     "hopperRejectAboveMarginCm" DOUBLE PRECISION,
ADD COLUMN     "hopperRejectBelowCm" DOUBLE PRECISION,
ADD COLUMN     "hopperStateHoldS" INTEGER;
