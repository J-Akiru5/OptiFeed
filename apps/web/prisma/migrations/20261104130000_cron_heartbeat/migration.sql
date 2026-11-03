-- #725: heartbeat for the pg_cron-driven endpoints. Additive only: one new
-- table, no existing row is read or changed.
CREATE TABLE "CronHeartbeat" (
    "name" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastStatus" TEXT NOT NULL,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronHeartbeat_pkey" PRIMARY KEY ("name")
);
