-- Restore the ErrorEvent table that 20261104180000_drop_dead_error_event removed.
--
-- Why: the table was genuinely orphaned when that migration was written (no
-- Prisma model, no reader, no writer, 0 rows). First-party error capture
-- (`lib/error-capture.ts`, model `ErrorEvent`, enum `ErrorSeverity`) landed
-- afterwards, so the drop became a live regression: `device-watch` throws on
-- `prisma.errorEvent.findMany()` and, because that call sits before the
-- retention deletes, every nightly cleanup after it is skipped too.
--
-- Idempotent by construction: this is safe to run directly against production
-- as a hotfix and to replay as the migration that records it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ErrorSeverity') THEN
    CREATE TYPE "ErrorSeverity" AS ENUM ('ERROR', 'WARNING', 'INFO');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ErrorEvent" (
  "id"          TEXT            NOT NULL,
  "fingerprint" TEXT            NOT NULL,
  "message"     TEXT            NOT NULL,
  "stack"       TEXT,
  "route"       TEXT            NOT NULL,
  "severity"    "ErrorSeverity" NOT NULL DEFAULT 'ERROR',
  "context"     JSONB,
  "firstSeenAt" TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "count"       INTEGER         NOT NULL DEFAULT 1,
  "resolved"    BOOLEAN         NOT NULL DEFAULT false,
  "resolvedAt"  TIMESTAMP(3),
  "resolvedBy"  TEXT,
  CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ErrorEvent_fingerprint_key" ON "ErrorEvent" ("fingerprint");
CREATE INDEX IF NOT EXISTS "ErrorEvent_lastSeenAt_idx" ON "ErrorEvent" ("lastSeenAt");
CREATE INDEX IF NOT EXISTS "ErrorEvent_resolved_lastSeenAt_idx" ON "ErrorEvent" ("resolved", "lastSeenAt");

-- The app role reads and writes this table through the normal grants; the
-- explicit grant keeps parity with the other tenant tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'optifeed_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ErrorEvent" TO optifeed_app;
  END IF;
END $$;

SELECT to_regclass('public."ErrorEvent"')::text AS table_present;
