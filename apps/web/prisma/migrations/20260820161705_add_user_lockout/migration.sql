/*
  Warnings:

  - You are about to drop the column `relayState` on the `EnergyDevice` table. All the data in the column will be lost.
  - You are about to drop the `EnergyReading` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "EnergyReading" DROP CONSTRAINT "EnergyReading_deviceId_fkey";

-- AlterTable
ALTER TABLE "EnergyDevice" DROP COLUMN "relayState",
ADD COLUMN     "buttonFeedGrams" DOUBLE PRECISION NOT NULL DEFAULT 80,
ADD COLUMN     "feedLevelCm" DOUBLE PRECISION,
ADD COLUMN     "feedLevelPercent" DOUBLE PRECISION,
ADD COLUMN     "feedLevelUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "feederActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gramsPerFeeding" DOUBLE PRECISION NOT NULL DEFAULT 150,
ADD COLUMN     "hopperCapacityG" DOUBLE PRECISION,
ADD COLUMN     "hopperEmptyCm" DOUBLE PRECISION,
ADD COLUMN     "hopperFullCm" DOUBLE PRECISION,
ADD COLUMN     "rtcOk" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedBy" TEXT,
ADD COLUMN     "autoCleared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "category" TEXT;

-- DropTable
DROP TABLE "EnergyReading";

-- CreateTable
CREATE TABLE "user_lockout" (
    "farmId" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_lockout_pkey" PRIMARY KEY ("farmId")
);

-- CreateIndex
CREATE INDEX "FcrReport_pondId_periodStart_idx" ON "FcrReport"("pondId", "periodStart");

-- CreateIndex
CREATE INDEX "Notification_pondId_read_idx" ON "Notification"("pondId", "read");

-- CreateIndex
CREATE INDEX "Pond_ownerId_idx" ON "Pond"("ownerId");
