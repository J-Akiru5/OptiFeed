-- Alert episode dedup (#585)
--
-- Production holds 21 duplicate open episodes created before the #534 fix: the
-- heartbeat, the device-watch cron and ingest each ran find-then-create with no
-- unique constraint behind it. This migration folds those duplicates into one
-- row per episode and adds the constraint that makes the race impossible. It
-- never deletes a row.
--
-- Open episode = "episodeKey" IS NOT NULL
--                AND "resolvedAt" IS NULL
--                AND "autoCleared" = FALSE
--                AND "supersededById" IS NULL
--
-- The last clause matters: a row a previous fold marked superseded is audit
-- history. The #534 migration left its folded rows with "resolvedAt" /
-- "autoCleared" untouched and without an "episodeKey"; those are outside the
-- episode set this migration indexes. Step 1 closes any superseded row that
-- does carry a key (for example one folded after the #534 backfill).
--
-- Idempotent: both UPDATEs are driven by the current open set (a second run
-- changes nothing) and the column/index use IF NOT EXISTS.
--
-- Post-migration verification (expected: 0 rows):
--   SELECT "pondId", "episodeKey", COUNT(*) AS open_rows
--   FROM "Notification"
--   WHERE "episodeKey" IS NOT NULL
--     AND "resolvedAt" IS NULL
--     AND "autoCleared" = FALSE
--     AND "supersededById" IS NULL
--   GROUP BY "pondId", "episodeKey"
--   HAVING COUNT(*) > 1;
-- docs/sql/alert-episode-dedup-verify.sql keeps this query plus the stricter
-- episodeKey-only check, the index check and the audit-trail check.

ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "resolutionReason" TEXT;

-- 1. A row already folded by the previous migration that still carries an
--    episode key is history, not a live alert. (#534 left folded rows with a
--    null episodeKey; those were never in the open-episode set.)
UPDATE "Notification"
SET
  "resolvedAt" = NOW(),
  "autoCleared" = TRUE,
  "read" = TRUE,
  "resolutionReason" = 'superseded_historical_duplicate'
WHERE "episodeKey" IS NOT NULL
  AND "supersededById" IS NOT NULL
  AND "resolvedAt" IS NULL
  AND "autoCleared" = FALSE;

-- 2. Keep the newest live open row per episodeKey and fold the rest into it.
--    The partition is the same key as the unique index, not (pondId,
--    episodeKey): a device moved between ponds must not leave a second open row
--    that the index would reject. Same-pond duplicates are a subset of this.
WITH ranked AS (
  SELECT
    "id",
    FIRST_VALUE("id") OVER (
      PARTITION BY "episodeKey"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS keeper_id
  FROM "Notification"
  WHERE "episodeKey" IS NOT NULL
    AND "resolvedAt" IS NULL
    AND "autoCleared" = FALSE
    AND "supersededById" IS NULL
)
UPDATE "Notification" AS n
SET
  "supersededById" = ranked.keeper_id,
  "resolvedAt" = NOW(),
  "autoCleared" = TRUE,
  "read" = TRUE,
  "resolutionReason" = 'duplicate_open_episode'
FROM ranked
WHERE n."id" = ranked."id"
  AND n."id" <> ranked.keeper_id;

-- 3. The race-safe guarantee. Partial: only a live episode is unique; every
--    closed or superseded row is unlimited history.
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_one_open_per_episode"
  ON "Notification" ("episodeKey")
  WHERE "resolvedAt" IS NULL
    AND "autoCleared" = FALSE
    AND "supersededById" IS NULL;
