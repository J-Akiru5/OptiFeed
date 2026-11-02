-- #585: one open alert episode per condition.
--
-- Production held 21 duplicate open episodes created before #534 (10 feeding,
-- 9 pellet, 2 connectivity). This migration folds them without deleting history:
-- the newest open row per `episodeKey` is the keeper; the rest are resolved and
-- point at it through `supersededById` (the audit reason). Re-running the CTE is
-- a no-op because the folded rows no longer match the open predicate.
--
-- The lock keeps an ingest/heartbeat insert from committing a new duplicate
-- between the cleanup snapshot and the unique-index build.
LOCK TABLE "Notification" IN SHARE ROW EXCLUSIVE MODE;

WITH ranked AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "episodeKey"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS keeper_id,
    row_number() OVER (
      PARTITION BY "episodeKey"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "Notification"
  WHERE "episodeKey" IS NOT NULL
    AND "resolvedAt" IS NULL
    AND "autoCleared" = false
)
UPDATE "Notification" AS n
SET
  "autoCleared" = true,
  "read" = true,
  "resolvedAt" = now(),
  "supersededById" = ranked.keeper_id
FROM ranked
WHERE n."id" = ranked."id"
  AND ranked.rn > 1;

-- #534 stamped legacy rows with `pondId:category` (e.g. `cmt...:feeding`).
-- Runtime keys are device-prefixed, so no openEpisode/closeEpisode can ever
-- match a legacy key. Resolve every open legacy row (including the keeper) so
-- it cannot remain as a phantom bell/list row; the next heartbeat opens the
-- proper device-keyed episode.
UPDATE "Notification"
SET
  "autoCleared" = true,
  "read" = true,
  "resolvedAt" = now()
WHERE "episodeKey" IS NOT NULL
  AND "resolvedAt" IS NULL
  AND "autoCleared" = false
  AND "episodeKey" NOT LIKE 'pellet:%'
  AND "episodeKey" NOT LIKE 'pellet-days:%'
  AND "episodeKey" NOT LIKE 'offline:%'
  AND "episodeKey" NOT LIKE 'cold-water:%';

-- The partial unique index is the concurrency guarantee behind openEpisode's
-- find-then-create. Non-episode rows (episodeKey NULL) are unconstrained: a
-- PostgreSQL unique index permits multiple NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_episodeKey_open_key"
ON "Notification" ("episodeKey")
WHERE "resolvedAt" IS NULL AND "autoCleared" = false;
