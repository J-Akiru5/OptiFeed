-- Issue #590: background jobs retry forever with no dead letter.
--
-- ADDITIVE ONLY. Two nullable columns and one index. `nextAttemptAt` carries the
-- exponential backoff between attempts; `lastError` is the operator-facing
-- detail from the last attempt (the existing `error` column stays the sanitized
-- message the tenant status endpoint may show).

ALTER TABLE "BackgroundJob" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
ALTER TABLE "BackgroundJob" ADD COLUMN "lastError" TEXT;

CREATE INDEX "BackgroundJob_status_nextAttemptAt_idx" ON "BackgroundJob"("status", "nextAttemptAt");

-- Before this release `requeueStaleJobs` reset a crashed lease unconditionally,
-- so a job can already sit in the queue at the attempt cap. The new claim
-- predicate would never pick it up and the TTL purge would delete it silently;
-- dead-letter it instead, once.
UPDATE "BackgroundJob"
SET
	"status" = 'failed',
	"error" = 'The job failed. Try again.',
	"lastError" = 'Exceeded the attempt cap before retries were capped.',
	"finishedAt" = (NOW() AT TIME ZONE 'UTC'),
	"nextAttemptAt" = NULL,
	"lockedAt" = NULL,
	"lockedBy" = NULL
WHERE "status" = 'queued' AND "attempts" >= 5;
