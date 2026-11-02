-- Verification for migration 20261102200000_alert_episode_dedup (#585).
--
-- Read-only. Run after the migration on the target database (or on a restored
-- copy first), then record the output. Queries 1 and 1b must return 0 rows.
--
--   psql "$DIRECT_URL" -f docs/sql/alert-episode-dedup-verify.sql
--
-- Rehearsal before the shared database (acceptance criterion for #585):
--   1. Restore the latest backup into a disposable database.
--   2. Apply
--      apps/web/prisma/migrations/20261102200000_alert_episode_dedup/migration.sql
--      (or `prisma migrate deploy` against that copy).
--   3. Run this file. Queries 1 and 1b return 0 rows, query 3's
--      total_notifications matches the backup, and query 2 shows the index.
--   4. Only then apply through the normal production rollout.

-- 1. No duplicate open episode groups. Expected: (0 rows).
--    Grouping by pondId keeps the shape the issue reported.
SELECT
  "pondId",
  "episodeKey",
  COUNT(*) AS open_rows
FROM "Notification"
WHERE "episodeKey" IS NOT NULL
  AND "resolvedAt" IS NULL
  AND "autoCleared" = FALSE
  AND "supersededById" IS NULL
GROUP BY "pondId", "episodeKey"
HAVING COUNT(*) > 1
ORDER BY open_rows DESC, "episodeKey";

-- 1b. The same check on the index key alone, which is stricter: the partial
--     index is on episodeKey, so a device moved between ponds must not leave a
--     second open row behind. Expected: (0 rows).
SELECT
  "episodeKey",
  COUNT(*) AS open_rows,
  array_agg(DISTINCT "pondId") AS ponds
FROM "Notification"
WHERE "episodeKey" IS NOT NULL
  AND "resolvedAt" IS NULL
  AND "autoCleared" = FALSE
  AND "supersededById" IS NULL
GROUP BY "episodeKey"
HAVING COUNT(*) > 1
ORDER BY open_rows DESC, "episodeKey";

-- 2. The partial unique index exists with the expected predicate.
--    Expected: one row whose indexdef contains UNIQUE ... (episodeKey) and the
--    three WHERE clauses from the migration.
SELECT indexdef
FROM pg_indexes
WHERE schemaname = current_schema()
  AND tablename = 'Notification'
  AND indexname = 'Notification_one_open_per_episode';

-- 3. History is intact: nothing was deleted, and the folded rows carry a
--    recorded reason. Compare total_notifications with the pre-migration
--    backup/audit count; it must be unchanged.
SELECT
  COUNT(*) AS total_notifications,
  COUNT(*) FILTER (WHERE "supersededById" IS NOT NULL) AS superseded_rows,
  COUNT(*) FILTER (WHERE "resolutionReason" = 'duplicate_open_episode') AS folded_duplicate_rows,
  COUNT(*) FILTER (WHERE "resolutionReason" = 'superseded_historical_duplicate') AS closed_historical_rows
FROM "Notification";

-- 4. Optional: the reported production groups should now have one open row
--    each. Replace the pond id with the audited one when running this.
--    Expected: one row with open_rows = 1 for each episode key.
SELECT
  "pondId",
  "episodeKey",
  COUNT(*) AS open_rows,
  MIN("createdAt") AS oldest_open,
  MAX("createdAt") AS newest_open
FROM "Notification"
WHERE "pondId" = 'cmtcr6jzk0002ayhgu6nf095r'
  AND "episodeKey" IS NOT NULL
  AND "resolvedAt" IS NULL
  AND "autoCleared" = FALSE
  AND "supersededById" IS NULL
GROUP BY "pondId", "episodeKey"
ORDER BY "episodeKey";
