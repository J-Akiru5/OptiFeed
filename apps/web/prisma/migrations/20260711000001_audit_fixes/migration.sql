-- AlterTable: Add eventId column for idempotent event ingestion
ALTER TABLE "FeedEvent" ADD COLUMN "eventId" TEXT;

-- CreateIndex: unique constraint on eventId for dedup
CREATE UNIQUE INDEX "FeedEvent_eventId_key" ON "FeedEvent"("eventId");

-- AlterTable: RENAME COLUMN createdAt -> receivedAt (safe rename, preserves data)
ALTER TABLE "FeedEvent" RENAME COLUMN "createdAt" TO "receivedAt";

-- DropIndex: drop old index on (deviceId, createdAt)
DROP INDEX "FeedEvent_deviceId_createdAt_idx";

-- CreateIndex: new index on (deviceId, receivedAt) for History queries
CREATE INDEX "FeedEvent_deviceId_receivedAt_idx" ON "FeedEvent"("deviceId", "receivedAt");

-- CreateIndex: index on BiomassLog (pondId, recordedAt) for biomass history queries
CREATE INDEX "BiomassLog_pondId_recordedAt_idx" ON "BiomassLog"("pondId", "recordedAt");
