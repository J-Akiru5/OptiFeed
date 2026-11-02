-- Alert episodes (#534)
--
-- Recurring condition alerts used to append one row per reading, so a single
-- day could hold 150+ near-identical rows. New writes coalesce into one row per
-- episode (episodeKey/resolvedAt). This migration adds the columns and folds the
-- rows that already exist, without deleting anything: duplicates point at the
-- surviving row through supersededById and are hidden from every list.

ALTER TABLE "Notification" ADD COLUMN "episodeKey" TEXT,
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "supersededById" TEXT;

CREATE INDEX "Notification_episodeKey_idx" ON "Notification"("episodeKey");
CREATE INDEX "Notification_pondId_supersededById_idx" ON "Notification"("pondId", "supersededById");

-- Fold historical duplicates: within one pond, category, message and calendar
-- day, keep the earliest row and point the rest at it.
WITH ranked AS (
  SELECT
    "id",
    FIRST_VALUE("id") OVER (
      PARTITION BY "pondId", "category", "message", date_trunc('day', "createdAt")
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS keeper
  FROM "Notification"
)
UPDATE "Notification" AS n
SET "supersededById" = ranked.keeper
FROM ranked
WHERE n."id" = ranked."id"
  AND ranked.keeper <> n."id";

-- Stamp the condition key on the surviving recurring alerts so the next episode
-- reuses the row instead of opening a new one under a different key.
UPDATE "Notification"
SET "episodeKey" = "pondId" || ':' || COALESCE("category", 'system')
WHERE "category" IN ('pellet', 'connectivity', 'feeding', 'system')
  AND "supersededById" IS NULL
  AND "episodeKey" IS NULL;

-- Rows already auto-cleared describe a condition that ended.
UPDATE "Notification"
SET "resolvedAt" = "createdAt"
WHERE "autoCleared" = TRUE
  AND "resolvedAt" IS NULL;
