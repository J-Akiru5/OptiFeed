-- #479 M3C.10 / decision O24: per-device daily connectivity, kept for 90 days.
--
-- ADDITIVE ONLY. One new table, two indexes and one foreign key; no existing
-- table, column, constraint, policy or row is touched, renamed or dropped.
-- The matching Prisma model is `DeviceConnectivityDaily` in prisma/schema.prisma.
--
-- `day` is a DATE (UTC calendar day, not a timestamp), so the unique key is
-- stable and a session time-zone change cannot shift a bucket. The
-- `device-watch` cron recomputes the previous completed UTC day from
-- `FeedEvent` heartbeat rows before the 7-day heartbeat sweep deletes them,
-- then prunes rows older than 90 days. A day with no stored row is shown as
-- "no data"; nothing is estimated from a neighbouring day.
--
-- The unique (deviceId, day) index is also the per-device history access path,
-- so no second index repeats those columns; `day` alone serves the fleet trend.
-- The foreign key follows the other device-telemetry tables and cascades on
-- device deletion, so a removed feeder cannot leave a ghost in the trend.

CREATE TABLE IF NOT EXISTS "DeviceConnectivityDaily" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "onlineMinutes" INTEGER NOT NULL,
    "heartbeatCount" INTEGER NOT NULL,
    "gapCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceConnectivityDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceConnectivityDaily_deviceId_day_key" ON "DeviceConnectivityDaily"("deviceId", "day");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeviceConnectivityDaily_day_idx" ON "DeviceConnectivityDaily"("day");

-- AddForeignKey
-- Guarded so a re-run after partial application does not fail on an existing
-- constraint. The target and action match schema.prisma exactly.
DO $$
BEGIN
    ALTER TABLE "DeviceConnectivityDaily" ADD CONSTRAINT "DeviceConnectivityDaily_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "EnergyDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Deny-by-default for PostgREST roles, same as the other core tables. The app
-- connects as the owner role, which bypasses RLS. Do NOT add FORCE.
ALTER TABLE "DeviceConnectivityDaily" ENABLE ROW LEVEL SECURITY;
