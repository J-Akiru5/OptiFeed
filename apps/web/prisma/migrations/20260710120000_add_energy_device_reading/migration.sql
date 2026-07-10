-- CreateTable
CREATE TABLE "EnergyDevice" (
    "id" TEXT NOT NULL,
    "mac" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pondId" TEXT,
    "relayState" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnergyDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnergyReading" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "relayState" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnergyReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnergyDevice_mac_key" ON "EnergyDevice"("mac");

-- CreateIndex
CREATE UNIQUE INDEX "EnergyDevice_token_key" ON "EnergyDevice"("token");

-- CreateIndex
CREATE INDEX "EnergyReading_deviceId_timestamp_idx" ON "EnergyReading"("deviceId", "timestamp");

-- AddForeignKey
ALTER TABLE "EnergyDevice" ADD CONSTRAINT "EnergyDevice_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "Pond"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyReading" ADD CONSTRAINT "EnergyReading_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "EnergyDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
