-- CreateTable
CREATE TABLE "Pond" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "feedingRatePct" DOUBLE PRECISION NOT NULL,
    "feedsPerDay" INTEGER NOT NULL,
    "scheduleStart" TIME NOT NULL,
    "scheduleEnd" TIME NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pond_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connectivity" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "hopperLevelPct" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiomassLog" (
    "id" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "sampleWeightKg" DOUBLE PRECISION NOT NULL,
    "sampleLengthCm" DOUBLE PRECISION NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "avgWeightKg" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BiomassLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedingEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "scheduledTime" TIMESTAMP(3) NOT NULL,
    "dispensedVolumeG" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FcrReport" (
    "id" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalFeedKg" DOUBLE PRECISION NOT NULL,
    "biomassGainKg" DOUBLE PRECISION NOT NULL,
    "fcrValue" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "FcrReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "linkTo" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "Pond"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiomassLog" ADD CONSTRAINT "BiomassLog_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "Pond"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedingEvent" ADD CONSTRAINT "FeedingEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FcrReport" ADD CONSTRAINT "FcrReport_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "Pond"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "Pond"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
