-- DropIndex
DROP INDEX "FeedEvent_eventId_key";

-- AlterTable
ALTER TABLE "EnergyDevice" ADD COLUMN     "pendingQueuedEvents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "queuedDropped" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
-- Guardrail: an offline-queue replay is identified by (device_id, event_id).
-- The old global unique on eventId alone was too strong (two devices may mint
-- the same id) and too weak (it did not express the real key).
CREATE UNIQUE INDEX "FeedEvent_deviceId_eventId_key" ON "FeedEvent"("deviceId", "eventId");
