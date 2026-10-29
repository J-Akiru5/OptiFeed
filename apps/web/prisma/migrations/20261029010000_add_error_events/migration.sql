-- Mission 2026-10-29e (I-64, owner decision E1): first-party error capture.
--
-- ADDITIVE ONLY. One new enum, one new table, three indexes. No existing
-- table, column, constraint, policy or row is touched, renamed or dropped.
-- The matching Prisma model is `ErrorEvent` in prisma/schema.prisma.
--
-- Production precondition: take a database backup before applying this
-- migration, per the release PR. `prisma migrate deploy` applies it as the
-- next migration; nothing here is data-mutating.

CREATE TYPE "ErrorSeverity" AS ENUM ('ERROR', 'WARNING', 'INFO');

CREATE TABLE "ErrorEvent" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "route" TEXT NOT NULL,
    "severity" "ErrorSeverity" NOT NULL DEFAULT 'ERROR',
    "context" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

-- Dedupe key: one row per distinct error.
CREATE UNIQUE INDEX "ErrorEvent_fingerprint_key" ON "ErrorEvent"("fingerprint");

-- Newest-activity list and the 30-day retention sweep.
CREATE INDEX "ErrorEvent_lastSeenAt_idx" ON "ErrorEvent"("lastSeenAt");

-- Unresolved/resolved filter on the platform error console.
CREATE INDEX "ErrorEvent_resolved_lastSeenAt_idx" ON "ErrorEvent"("resolved", "lastSeenAt");
