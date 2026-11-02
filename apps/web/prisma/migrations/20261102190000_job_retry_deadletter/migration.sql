-- Issue #590: background jobs retry forever with no dead letter.
--
-- ADDITIVE ONLY. Two nullable columns and one index. `nextAttemptAt` carries the
-- exponential backoff between attempts; `lastError` is the operator-facing
-- detail from the last attempt (the existing `error` column stays the sanitized
-- message the tenant status endpoint may show).

ALTER TABLE "BackgroundJob" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
ALTER TABLE "BackgroundJob" ADD COLUMN "lastError" TEXT;

CREATE INDEX "BackgroundJob_status_nextAttemptAt_idx" ON "BackgroundJob"("status", "nextAttemptAt");
