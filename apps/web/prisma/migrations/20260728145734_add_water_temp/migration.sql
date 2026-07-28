-- AlterTable
ALTER TABLE "EnergyDevice" ADD COLUMN     "waterTempC" DOUBLE PRECISION,
ADD COLUMN     "waterTempOk" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "waterTempUpdatedAt" TIMESTAMP(3);
