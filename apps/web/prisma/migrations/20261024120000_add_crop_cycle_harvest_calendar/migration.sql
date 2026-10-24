-- Crop cycle + harvest calendar
-- Additive only. No existing columns are dropped or rewritten.

-- CreateEnum
CREATE TYPE "CropCycleStatus" AS ENUM ('ACTIVE', 'HARVESTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PondEventType" AS ENUM ('STOCKING', 'HARVEST_PLANNED', 'HARVEST_ACTUAL', 'SAMPLING', 'MAINTENANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "PondEventStatus" AS ENUM ('PLANNED', 'DONE', 'MISSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Pond" ADD COLUMN "isFallow" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CropCycle" (
    "id" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "farmId" TEXT,
    "label" TEXT,
    "status" "CropCycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "stockingDate" DATE NOT NULL,
    "stockingCount" INTEGER NOT NULL,
    "stockingAvgWeightG" DOUBLE PRECISION,
    "growOutDays" INTEGER NOT NULL DEFAULT 135,
    "targetHarvestDate" DATE NOT NULL,
    "targetHarvestWeightG" DOUBLE PRECISION,
    "expectedSurvivalPct" DOUBLE PRECISION,
    "actualHarvestDate" DATE,
    "actualHarvestWeightKg" DOUBLE PRECISION,
    "actualHarvestCount" INTEGER,
    "actualFcr" DOUBLE PRECISION,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CropCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PondEvent" (
    "id" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "cropCycleId" TEXT,
    "farmId" TEXT,
    "type" "PondEventType" NOT NULL,
    "status" "PondEventStatus" NOT NULL DEFAULT 'PLANNED',
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "source" TEXT,
    "sourceId" TEXT,
    "createdBy" TEXT NOT NULL,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PondEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "cropCycleId" TEXT,
    "pondEventId" TEXT,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "recipient" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CropCycle_pondId_status_idx" ON "CropCycle"("pondId", "status");

-- CreateIndex
CREATE INDEX "CropCycle_farmId_idx" ON "CropCycle"("farmId");

-- One active cycle per pond. The partial unique index is the race-safe
-- guarantee behind the server action's friendly error message.
CREATE UNIQUE INDEX "CropCycle_one_active_per_pond" ON "CropCycle"("pondId") WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE INDEX "PondEvent_pondId_startsAt_idx" ON "PondEvent"("pondId", "startsAt");

-- CreateIndex
CREATE INDEX "PondEvent_farmId_startsAt_idx" ON "PondEvent"("farmId", "startsAt");

-- CreateIndex
CREATE INDEX "PondEvent_cropCycleId_idx" ON "PondEvent"("cropCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderLog_dedupeKey_key" ON "ReminderLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "ReminderLog_pondId_kind_idx" ON "ReminderLog"("pondId", "kind");

-- CreateIndex
CREATE INDEX "ReminderLog_cropCycleId_idx" ON "ReminderLog"("cropCycleId");

-- AddForeignKey
ALTER TABLE "CropCycle" ADD CONSTRAINT "CropCycle_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "Pond"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PondEvent" ADD CONSTRAINT "PondEvent_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "Pond"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PondEvent" ADD CONSTRAINT "PondEvent_cropCycleId_fkey" FOREIGN KEY ("cropCycleId") REFERENCES "CropCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
