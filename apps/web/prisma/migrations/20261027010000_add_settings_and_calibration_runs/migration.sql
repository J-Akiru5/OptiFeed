-- Issues #187 (list page size), #190 (org settings, device approval), #191 (calibration history).
-- Additive only: new enums, new tables, and EnergyDevice columns with defaults (existing feeders stay APPROVED).

-- CreateEnum
CREATE TYPE "DeviceApproval" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DeviceRegistrationMode" AS ENUM ('ADMIN_APPROVAL', 'SELF_REGISTER');

-- CreateEnum
CREATE TYPE "CalibrationKind" AS ENUM ('RATE_TEST', 'TARGET_CHECK');

-- AlterTable
ALTER TABLE "EnergyDevice" ADD COLUMN     "approvalStatus" "DeviceApproval" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "lastCalibratedAt" TIMESTAMP(3),
ADD COLUMN     "recalibrationIntervalDays" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "OrgSetting" (
    "orgId" TEXT NOT NULL,
    "defaultFeedingRatePct" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "hopperLowPct" INTEGER NOT NULL DEFAULT 20,
    "offlineAfterMin" INTEGER NOT NULL DEFAULT 30,
    "missedFeedingAlerts" BOOLEAN NOT NULL DEFAULT true,
    "alertRoles" "MemberRole"[] DEFAULT ARRAY['OWNER', 'ADMIN']::"MemberRole"[],
    "deviceRegistration" "DeviceRegistrationMode" NOT NULL DEFAULT 'ADMIN_APPROVAL',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSetting_pkey" PRIMARY KEY ("orgId")
);

-- CreateTable
CREATE TABLE "CalibrationRun" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "kind" "CalibrationKind" NOT NULL,
    "durationMs" INTEGER,
    "targetGrams" DOUBLE PRECISION,
    "measuredGrams" DOUBLE PRECISION NOT NULL,
    "gramsPerSecondBefore" DOUBLE PRECISION NOT NULL,
    "gramsPerSecondAfter" DOUBLE PRECISION,
    "errorPct" DOUBLE PRECISION,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalibrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalibrationRun_deviceId_createdAt_idx" ON "CalibrationRun"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "CalibrationRun_sessionId_idx" ON "CalibrationRun"("sessionId");

-- AddForeignKey
ALTER TABLE "CalibrationRun" ADD CONSTRAINT "CalibrationRun_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "EnergyDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deny-by-default for PostgREST roles, same as the other core tables (20261013020000).
-- The app connects as the owner role, which bypasses RLS. Do NOT add FORCE.
ALTER TABLE "PlatformSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalibrationRun" ENABLE ROW LEVEL SECURITY;
