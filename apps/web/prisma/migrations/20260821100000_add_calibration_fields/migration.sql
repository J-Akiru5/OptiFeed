-- AlterTable: Add duration and temperature calibration fields to EnergyDevice
ALTER TABLE "EnergyDevice" ADD COLUMN "gramsPerSecond" DOUBLE PRECISION NOT NULL DEFAULT 4.0;
ALTER TABLE "EnergyDevice" ADD COLUMN "tempOffsetC" DOUBLE PRECISION NOT NULL DEFAULT 0;
