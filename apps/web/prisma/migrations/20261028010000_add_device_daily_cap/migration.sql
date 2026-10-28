-- Amendment A-001 (docs/amendments/A-001-feeding-single-source.md):
-- the pond's daily feed ceiling. NULL means "use the 2,000 g default";
-- the 5,000 g hard guard stays in lib/limits.ts and the firmware.
ALTER TABLE "EnergyDevice" ADD COLUMN "dailyCapG" INTEGER;
