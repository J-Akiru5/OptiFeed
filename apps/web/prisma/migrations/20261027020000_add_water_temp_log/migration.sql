-- Issue #188: water temperature history for the dashboard trend. Additive only.

-- CreateTable
CREATE TABLE "WaterTempLog" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tempC" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "farmId" TEXT,

    CONSTRAINT "WaterTempLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaterTempLog_deviceId_recordedAt_idx" ON "WaterTempLog"("deviceId", "recordedAt");

-- CreateIndex
CREATE INDEX "WaterTempLog_farmId_idx" ON "WaterTempLog"("farmId");

-- AddForeignKey
ALTER TABLE "WaterTempLog" ADD CONSTRAINT "WaterTempLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "EnergyDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deny-by-default for PostgREST roles (see 20261013020000). Do NOT add FORCE.
ALTER TABLE "WaterTempLog" ENABLE ROW LEVEL SECURITY;
