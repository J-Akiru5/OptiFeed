-- Post-migration verification for #585.
-- Run with a read-only operator connection after `prisma migrate deploy`.
-- Both queries must return zero rows; any row is a cleanup/regression failure.

-- 1. No condition may have more than one open episode.
SELECT "episodeKey", count(*) AS "openRows"
FROM "Notification"
WHERE "episodeKey" IS NOT NULL
  AND "resolvedAt" IS NULL
  AND "autoCleared" = false
GROUP BY "episodeKey"
HAVING count(*) > 1;

-- 2. No legacy `pondId:category` key may remain open; runtime code can never
--    match or close one.
SELECT count(*) AS "legacyOpenRows"
FROM "Notification"
WHERE "episodeKey" IS NOT NULL
  AND "resolvedAt" IS NULL
  AND "autoCleared" = false
  AND "episodeKey" NOT LIKE 'pellet:%'
  AND "episodeKey" NOT LIKE 'pellet-days:%'
  AND "episodeKey" NOT LIKE 'offline:%'
  AND "episodeKey" NOT LIKE 'cold-water:%';
