-- Drop the orphaned ErrorEvent table.
--
-- Owner decision 2026-11-04: drop it rather than model it.
--
-- Evidence gathered immediately before writing this migration, against
-- production: 0 rows, 0 foreign keys, 0 views referencing it. It has no Prisma
-- model and no reader or writer anywhere in the repository; it was left behind
-- when Sentry was removed and error reporting became the console line plus the
-- ALERT_WEBHOOK_URL transport (#729).
--
-- The guard refuses to drop a table that holds rows, so a wrong assumption at
-- apply time aborts the migration instead of destroying error history.

DO $$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public."ErrorEvent"') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM "ErrorEvent"' INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'ErrorEvent holds % row(s); refusing to drop a non-empty table', n;
  END IF;
END $$;

DROP TABLE IF EXISTS "ErrorEvent";
