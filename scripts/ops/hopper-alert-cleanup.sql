-- =============================================================================
-- #903 - collapse the duplicate-heartbeat hopper alert chains (DATA ONLY)
-- =============================================================================
--
-- What happened: before #903, a heartbeat whose feed projection sat inside the
-- two-day window resolved the `pellet-days:<deviceId>` episode and immediately
-- re-opened it, on every beat. Production holds ~6,000 rows of that chain where
-- one open episode per key was intended.
--
-- What this file does: it NEVER deletes. For every `episodeKey` that still has
-- an open row, it keeps that row as the episode and marks the older unresolved
-- members of the same chain with
--
--     "resolvedAt"       = NOW()
--     "autoCleared"      = TRUE
--     "read"             = TRUE
--     "resolutionReason" = 'duplicate-heartbeat-episode'
--
-- `supersededById` is deliberately left alone: these rows are not folded into
-- another episode, they are duplicates that were never closed. They stay
-- visible in the audit trail, and the retention pass eventually removes them.
--
-- Scope: exactly one tenant, never a whole database.
--   * required  -v tenant_owner=<Pond.ownerId>          (the product key)
--   * optional  -v tenant_farm=<Pond.farmId>            (the immutable stamp)
-- The script refuses to run without `tenant_owner`, refuses a selector that
-- matches no pond, and every statement is additionally constrained to the pond
-- ids resolved from that selector inside the transaction.
--
-- This is DATA ONLY: no schema change, no table, no index. It is one
-- transaction with an advisory lock, so a second concurrent run waits and then
-- reports zero targets. If any assertion or statement fails, nothing commits.
--
-- PRECONDITION: a full logical backup taken immediately before this runs. The
-- backup is the rollback; there is no inverse UPDATE for a large chain that is
-- worth trusting more than a restore.
--
-- Run - always dry-run the count query at the bottom of this header first, and
-- always with ON_ERROR_STOP:
--
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 \
--        -v tenant_owner='demo-farmer-1' \
--        -v tenant_farm='farm_demo-farmer-1' \
--        -f scripts/ops/hopper-alert-cleanup.sql
--
-- Tenant-B is a separate run with its own owner id (find it with
-- `SELECT id, "ownerId", "farmId" FROM "Pond" ORDER BY "ownerId"`); the script
-- never spans tenants in one execution.
--
-- Pre-flight (read only, no -v needed) - the same shape the script prints:
--
--   SELECT count(*) FILTER (WHERE "resolvedAt" IS NULL)                    AS unresolved,
--          count(*) FILTER (WHERE "resolvedAt" IS NULL
--                             AND "autoCleared" = FALSE
--                             AND "supersededById" IS NULL)                AS open,
--          count(DISTINCT "episodeKey")                                   AS episode_keys
--   FROM "Notification"
--   WHERE category = 'pellet' AND "episodeKey" IS NOT NULL;
--
-- Expected result after a successful run, per tenant:
--   * open rows per episodeKey: at most 1 (the partial unique index already
--     guarantees this; the script asserts it again inside the transaction)
--   * unresolved duplicates in scope: 0
--   * every row this run closed carries resolutionReason
--     'duplicate-heartbeat-episode'
--   * total row count unchanged (nothing is deleted)
--
-- Verified on the production snapshot in #903: 6,133 pellet rows, 6,029 with an
-- episodeKey, and only 2 open. Because the churn already resolved each row it
-- superseded, the measured chains leave almost nothing for this script to
-- close; the counts it prints are the authoritative answer for the run, and a
-- tenant whose rows are still unresolved will show the large drop the issue
-- describes.
-- =============================================================================

\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- Refuse to run unscoped. This is a client-side guard: with no tenant_owner the
-- transaction is never opened and nothing is read or written.
-- -----------------------------------------------------------------------------

\if :{?tenant_owner}
\else
  DO $$
  BEGIN
    RAISE EXCEPTION
      'Refusing to run unscoped: pass -v tenant_owner=<Pond.ownerId> (see the header of %).',
      'hopper-alert-cleanup.sql';
  END
  $$;
\endif

BEGIN;

SET LOCAL TIME ZONE 'UTC';
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '10s';

-- One cleanup per database at a time. Transaction-scoped: released by COMMIT or
-- ROLLBACK, so it needs no cleanup and cannot leak.
SELECT pg_advisory_xact_lock(903903);

-- -----------------------------------------------------------------------------
-- 1. Freeze the tenant scope and snapshot the counts the report needs
-- -----------------------------------------------------------------------------

CREATE TEMP TABLE cleanup_903_pond (
    id text PRIMARY KEY
) ON COMMIT DROP;

\if :{?tenant_farm}
INSERT INTO cleanup_903_pond (id)
SELECT p.id
FROM "Pond" p
WHERE p."ownerId" = :'tenant_owner'
  AND p."farmId" = :'tenant_farm';
\else
INSERT INTO cleanup_903_pond (id)
SELECT p.id
FROM "Pond" p
WHERE p."ownerId" = :'tenant_owner';
\endif

-- A selector that matches nothing is a typo, not a no-op worth committing.
DO $$
DECLARE
    ponds bigint;
BEGIN
    SELECT count(*) INTO ponds FROM cleanup_903_pond;
    IF ponds = 0 THEN
        RAISE EXCEPTION
            'Refusing to run: the tenant selector matched no Pond row. '
            'Check -v tenant_owner and -v tenant_farm.';
    END IF;
END
$$;

CREATE TEMP TABLE cleanup_903_counts (
    phase text NOT NULL,
    metric text NOT NULL,
    value bigint NOT NULL
) ON COMMIT DROP;

INSERT INTO cleanup_903_counts (phase, metric, value)
SELECT 'before', 'pellet_rows', count(*)
FROM "Notification" n
WHERE n.category = 'pellet'
  AND n."pondId" IN (SELECT id FROM cleanup_903_pond);

INSERT INTO cleanup_903_counts (phase, metric, value)
SELECT 'before', 'with_episode_key', count(*)
FROM "Notification" n
WHERE n.category = 'pellet'
  AND n."pondId" IN (SELECT id FROM cleanup_903_pond)
  AND n."episodeKey" IS NOT NULL;

INSERT INTO cleanup_903_counts (phase, metric, value)
SELECT 'before', 'unresolved', count(*)
FROM "Notification" n
WHERE n.category = 'pellet'
  AND n."pondId" IN (SELECT id FROM cleanup_903_pond)
  AND n."episodeKey" IS NOT NULL
  AND n."resolvedAt" IS NULL;

INSERT INTO cleanup_903_counts (phase, metric, value)
SELECT 'before', 'open', count(*)
FROM "Notification" n
WHERE n.category = 'pellet'
  AND n."pondId" IN (SELECT id FROM cleanup_903_pond)
  AND n."episodeKey" IS NOT NULL
  AND n."resolvedAt" IS NULL
  AND n."autoCleared" = FALSE
  AND n."supersededById" IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Choose the keeper and the duplicates
--
-- The keeper of an episodeKey is its newest OPEN row - the same predicate the
-- partial unique index `Notification_one_open_per_episode` enforces:
--
--   "resolvedAt" IS NULL AND "autoCleared" = FALSE AND "supersededById" IS NULL
--
-- A chain with no open row is left untouched: there is no episode to keep, and
-- its history is already closed. The selection blocks between the markers are
-- executed verbatim by lib/__tests__/hopper-alert-cleanup.test.ts against a
-- SQLite fixture, so keep them portable (no NOW(), no DISTINCT ON, no casts).
-- -----------------------------------------------------------------------------

CREATE TEMP TABLE cleanup_903_keeper (
    "episodeKey" text PRIMARY KEY,
    keeper_id text NOT NULL
) ON COMMIT DROP;

-- >>> selection:keeper
INSERT INTO cleanup_903_keeper ("episodeKey", keeper_id)
SELECT ranked."episodeKey", ranked.id
FROM (
    SELECT n."episodeKey",
           n.id,
           ROW_NUMBER() OVER (
               PARTITION BY n."episodeKey"
               ORDER BY n."createdAt" DESC, n.id DESC
           ) AS rn
    FROM "Notification" n
    WHERE n.category = 'pellet'
      AND n."pondId" IN (SELECT id FROM cleanup_903_pond)
      AND n."episodeKey" IS NOT NULL
      AND n."resolvedAt" IS NULL
      AND n."autoCleared" = FALSE
      AND n."supersededById" IS NULL
) ranked
WHERE ranked.rn = 1;
-- <<< selection:keeper

CREATE TEMP TABLE cleanup_903_target (
    id text PRIMARY KEY,
    "episodeKey" text NOT NULL
) ON COMMIT DROP;

-- >>> selection:target
INSERT INTO cleanup_903_target (id, "episodeKey")
SELECT n.id, n."episodeKey"
FROM "Notification" n
JOIN cleanup_903_keeper k ON k."episodeKey" = n."episodeKey"
WHERE n.category = 'pellet'
  AND n."pondId" IN (SELECT id FROM cleanup_903_pond)
  AND n."resolvedAt" IS NULL
  AND n.id <> k.keeper_id;
-- <<< selection:target

INSERT INTO cleanup_903_counts (phase, metric, value)
SELECT 'before', 'duplicate_rows_selected', count(*) FROM cleanup_903_target;

-- -----------------------------------------------------------------------------
-- 3. Close the duplicates (no delete, no supersede link)
-- -----------------------------------------------------------------------------

CREATE TEMP TABLE cleanup_903_log (
    ord serial,
    step text NOT NULL,
    affected bigint NOT NULL
) ON COMMIT DROP;

WITH closed AS (
    UPDATE "Notification" n
    SET "resolvedAt" = NOW(),
        "autoCleared" = TRUE,
        "read" = TRUE,
        "resolutionReason" = 'duplicate-heartbeat-episode'
    FROM cleanup_903_target t
    WHERE n.id = t.id
      AND n."pondId" IN (SELECT id FROM cleanup_903_pond)
      AND n."resolvedAt" IS NULL
    RETURNING n.id
)
INSERT INTO cleanup_903_log (step, affected)
SELECT 'duplicates closed', count(*) FROM closed;

-- -----------------------------------------------------------------------------
-- 4. Counts after, and the assertions that make a bad run roll back
-- -----------------------------------------------------------------------------

INSERT INTO cleanup_903_counts (phase, metric, value)
SELECT 'after', 'pellet_rows', count(*)
FROM "Notification" n
WHERE n.category = 'pellet'
  AND n."pondId" IN (SELECT id FROM cleanup_903_pond);

INSERT INTO cleanup_903_counts (phase, metric, value)
SELECT 'after', 'with_episode_key', count(*)
FROM "Notification" n
WHERE n.category = 'pellet'
  AND n."pondId" IN (SELECT id FROM cleanup_903_pond)
  AND n."episodeKey" IS NOT NULL;

INSERT INTO cleanup_903_counts (phase, metric, value)
SELECT 'after', 'unresolved', count(*)
FROM "Notification" n
WHERE n.category = 'pellet'
  AND n."pondId" IN (SELECT id FROM cleanup_903_pond)
  AND n."episodeKey" IS NOT NULL
  AND n."resolvedAt" IS NULL;

INSERT INTO cleanup_903_counts (phase, metric, value)
SELECT 'after', 'open', count(*)
FROM "Notification" n
WHERE n.category = 'pellet'
  AND n."pondId" IN (SELECT id FROM cleanup_903_pond)
  AND n."episodeKey" IS NOT NULL
  AND n."resolvedAt" IS NULL
  AND n."autoCleared" = FALSE
  AND n."supersededById" IS NULL;

INSERT INTO cleanup_903_counts (phase, metric, value)
SELECT 'after', 'duplicate_rows_selected', count(*)
FROM "Notification" n
JOIN cleanup_903_target t ON t.id = n.id
WHERE n."resolvedAt" IS NULL;

-- Assertions. Each one aborts the transaction (ON_ERROR_STOP + RAISE), so a
-- partial or wrong run cannot commit.
DO $$
DECLARE
    offenders bigint;
BEGIN
    -- Nothing may be deleted: the row count is unchanged.
    IF (SELECT value FROM cleanup_903_counts WHERE phase = 'before' AND metric = 'pellet_rows')
       <> (SELECT value FROM cleanup_903_counts WHERE phase = 'after' AND metric = 'pellet_rows') THEN
        RAISE EXCEPTION 'Assertion failed: pellet row count changed (this script must never delete)';
    END IF;

    -- No episodeKey in scope may hold more than one open row.
    SELECT count(*) INTO offenders
    FROM (
        SELECT n."episodeKey"
        FROM "Notification" n
        WHERE n.category = 'pellet'
          AND n."pondId" IN (SELECT id FROM cleanup_903_pond)
          AND n."episodeKey" IS NOT NULL
          AND n."resolvedAt" IS NULL
          AND n."autoCleared" = FALSE
          AND n."supersededById" IS NULL
        GROUP BY n."episodeKey"
        HAVING count(*) > 1
    ) duplicates;
    IF offenders > 0 THEN
        RAISE EXCEPTION
            'Assertion failed: % episodeKey(s) still have more than one open row', offenders;
    END IF;

    -- Every selected duplicate must now be closed with the documented reason.
    SELECT count(*) INTO offenders
    FROM "Notification" n
    JOIN cleanup_903_target t ON t.id = n.id
    WHERE n."resolvedAt" IS NULL
       OR n."autoCleared" = FALSE
       OR n."resolutionReason" IS DISTINCT FROM 'duplicate-heartbeat-episode';
    IF offenders > 0 THEN
        RAISE EXCEPTION 'Assertion failed: % selected duplicate(s) were not closed', offenders;
    END IF;

    -- Nothing outside the tenant scope moved.
    SELECT count(*) INTO offenders
    FROM "Notification" n
    WHERE n."resolutionReason" = 'duplicate-heartbeat-episode'
      AND n."pondId" NOT IN (SELECT id FROM cleanup_903_pond);
    IF offenders > 0 THEN
        RAISE EXCEPTION
            'Assertion failed: % row(s) outside the tenant scope carry this run''s reason', offenders;
    END IF;
END
$$;

-- The report. `before` is the state at the start of this transaction, `after`
-- the state it will commit; `duplicates closed` is the only mutated row count.
SELECT phase, metric, value
FROM cleanup_903_counts
ORDER BY phase DESC, metric;

SELECT step, affected FROM cleanup_903_log ORDER BY ord;

COMMIT;
