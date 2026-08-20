-- CreateTable
CREATE TABLE "FeedEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    "grams" DOUBLE PRECISION,
    "source" TEXT,
    "feedRequestId" TEXT,
    "commandId" TEXT,
    "rtcOk" BOOLEAN,
    "feederActive" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedLevelLog" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "levelPercent" DOUBLE PRECISION NOT NULL,
    "distanceCm" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedLevelLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedRequest" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "grams" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceStateEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actorId" TEXT,
    "metadata" JSONB,
    "deviceTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceStateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleCommand" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "scheduleStart" TIME NOT NULL,
    "scheduleEnd" TIME NOT NULL,
    "feedsPerDay" INTEGER NOT NULL,
    "feedingRatePct" DOUBLE PRECISION NOT NULL,
    "buttonFeedGrams" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdBy" TEXT,
    "appliedAt" TIMESTAMP(3),
    "deviceTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedEvent_deviceId_createdAt_idx" ON "FeedEvent"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedLevelLog_deviceId_recordedAt_idx" ON "FeedLevelLog"("deviceId", "recordedAt");

-- CreateIndex
CREATE INDEX "FeedRequest_deviceId_status_idx" ON "FeedRequest"("deviceId", "status");

-- CreateIndex
CREATE INDEX "DeviceStateEvent_deviceId_createdAt_idx" ON "DeviceStateEvent"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "DeviceStateEvent_eventType_createdAt_idx" ON "DeviceStateEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduleCommand_deviceId_status_idx" ON "ScheduleCommand"("deviceId", "status");

-- AddForeignKey
ALTER TABLE "FeedEvent" ADD CONSTRAINT "FeedEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "EnergyDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedLevelLog" ADD CONSTRAINT "FeedLevelLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "EnergyDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedRequest" ADD CONSTRAINT "FeedRequest_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "EnergyDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceStateEvent" ADD CONSTRAINT "DeviceStateEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "EnergyDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleCommand" ADD CONSTRAINT "ScheduleCommand_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "EnergyDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleCommand" ADD CONSTRAINT "ScheduleCommand_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "Pond"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
