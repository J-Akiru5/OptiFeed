-- =============================================================================
-- #709 - reconcile the demo tenant's contradictory history
-- =============================================================================
--
-- Tenant:  Pond.ownerId = 'demo-farmer-1'
--          Farm.id      = 'farm_demo-farmer-1'  (the telemetry ownership stamp)
--
-- This file is DATA ONLY. It does not change the Prisma schema, does not add or
-- drop a table, and does not touch any other tenant. It is one transaction: if
-- any assertion at the end fails, or any statement errors, nothing is committed.
--
-- Read scripts/ops/demo-reconcile/README.md before running it. The hard
-- precondition is a full logical backup taken immediately before this file is
-- executed. The backup is the rollback.
--
-- Order (see README for the reasoning):
--   0. freeze the tenant scope, snapshot the pre-images, run safety preflights
--   1. hand_fed: merge each farm day's duplicate rows into one daily total
--   2. FeedLevelLog: backfill only days with no reading, using the hopper model
--   3. FeedEvent: mark the 2000-01-01 heartbeats rtcOk = false (keep the rows)
--   4. FcrReport: decide, do not invent (rows are left unchanged; evidence kept)
--   5. demo-pond-001: retire the stale seed pond and its pending command
--   6. FeedEvent.dataSource: tag the 112 seed and 66 surviving imported rows
--   7. write one audit marker with the complete undo log, then assert and commit
--
-- Idempotent: every step is written so a second run reports 0 affected rows
-- (the audit marker is written at most once). A second run is a safe no-op.
--
-- Every guard is RELATIONAL: it derives its expectation inside the transaction
-- from the rows that matched at that moment. The 2026-11-03 audit counts
-- (112 seed, 66 import, 3 year-2000 rows, 48 level days) are NOT guards; the
-- tenant has been used since the audit and the measured 2026-11-04 state was
-- 512 FeedEvents, 132 hand_fed / 42,046 g, 11 missing level days, 2 year-2000
-- rows, and 4 FCR identity violations. Run dry-run.sql first to print every
-- derived count without changing anything.
--
-- All DateTime columns in this schema are TIMESTAMP(3) WITHOUT TIME ZONE that
-- store UTC, by project convention (the audit queries in #709 rely on the same
-- `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila'` idiom). Do not "fix" that
-- here: a session TimeZone other than UTC would silently shift every naive
-- comparison. The session is pinned to UTC below.
--
-- Run with:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/ops/demo-reconcile/reconcile.sql
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL TIME ZONE 'UTC';
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '10s';

-- One reconciliation at a time. Transaction-scoped, so it is released by
-- COMMIT or ROLLBACK and needs no cleanup.
SELECT pg_advisory_xact_lock(709709);

-- -----------------------------------------------------------------------------
-- 0. Freeze the tenant scope, snapshot pre-images, preflight
-- -----------------------------------------------------------------------------

-- The tenant's ponds. Both keys are used: ownerId is the product key and farmId
-- is the immutable telemetry stamp. A pond missing either is not in scope.
CREATE TEMP TABLE reconcile_709_pond (
    id text PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO reconcile_709_pond (id)
SELECT p.id
FROM "Pond" p
WHERE p."ownerId" = 'demo-farmer-1'
  AND p."farmId" = 'farm_demo-farmer-1';

-- Every device attached to a tenant pond, including devices on retired ponds.
-- Provenance and RTC repairs must reach the retired seed pond too.
CREATE TEMP TABLE reconcile_709_device (
    id text PRIMARY KEY,
    pond_id text NOT NULL,
    capacity_g numeric,
    full_cm numeric,
    empty_cm numeric,
    pond_status text NOT NULL
) ON COMMIT DROP;

INSERT INTO reconcile_709_device (id, pond_id, capacity_g, full_cm, empty_cm, pond_status)
SELECT d.id,
       d."pondId",
       d."hopperCapacityG"::numeric,
       d."hopperFullCm"::numeric,
       d."hopperEmptyCm"::numeric,
       p.status::text
FROM "EnergyDevice" d
JOIN "Pond" p ON p.id = d."pondId"
WHERE p.id IN (SELECT id FROM reconcile_709_pond);

-- A printed, ordered account of every mutation this run performed. It is
-- selected before the assertions so a failing run still shows what happened
-- (the rows themselves are rolled back).
CREATE TEMP TABLE reconcile_709_log (
    ord serial,
    step text NOT NULL,
    affected bigint,
    note text
) ON COMMIT DROP;

-- Values that must be unchanged by the repair.
CREATE TEMP TABLE reconcile_709_baseline ON COMMIT DROP AS
SELECT
    (SELECT coalesce(sum(e.grams), 0)
       FROM "FeedEvent" e
      WHERE e.source = 'hand_fed'
        AND e."deviceId" IN (SELECT id FROM reconcile_709_device)) AS handfed_g,
    (SELECT count(*)
       FROM "FeedEvent" e
      WHERE e."deviceId" IN (SELECT id FROM reconcile_709_device)) AS feed_rows,
    (SELECT count(*)
       FROM "FeedLevelLog" l
      WHERE l."deviceId" IN (SELECT id FROM reconcile_709_device)) AS level_rows;

-- Pre-image of every hand_fed row, so the audit marker can carry the exact
-- rows the merge removes. All columns, so a targeted undo can re-insert them.
CREATE TEMP TABLE reconcile_709_handfed_pre ON COMMIT DROP AS
SELECT e.id,
       e."deviceId",
       e."eventId",
       e."eventType",
       e."timestamp",
       e.grams,
       e.source,
       e."feedRequestId",
       e."commandId",
       e."rtcOk",
       e."feederActive",
       e."receivedAt",
       e."dataSource",
       e."farmId"
FROM "FeedEvent" e
WHERE e.source = 'hand_fed'
  AND e."deviceId" IN (SELECT id FROM reconcile_709_device);

-- Pre-image of the three demo-pond-001 rows the retirement changes.
CREATE TEMP TABLE reconcile_709_g9_pre ON COMMIT DROP AS
SELECT 'Pond' AS kind, to_jsonb(p) AS payload
FROM "Pond" p
WHERE p.id = 'demo-pond-001'
  AND p."ownerId" = 'demo-farmer-1'
  AND p."farmId" = 'farm_demo-farmer-1'
UNION ALL
SELECT 'EnergyDevice', to_jsonb(d)
FROM "EnergyDevice" d
WHERE d."pondId" = 'demo-pond-001'
  AND d."pondId" IN (SELECT id FROM reconcile_709_pond)
UNION ALL
SELECT 'ScheduleCommand', to_jsonb(c)
FROM "ScheduleCommand" c
WHERE c."pondId" = 'demo-pond-001'
  AND c."pondId" IN (SELECT id FROM reconcile_709_pond)
  AND c.status IN ('pending', 'sent');

DO $$
DECLARE
    n bigint;
BEGIN
    -- The target must be the demo tenant, not a database that merely looks similar.
    IF NOT EXISTS (
        SELECT 1 FROM "Farm"
        WHERE id = 'farm_demo-farmer-1' AND "ownerId" = 'demo-farmer-1'
    ) THEN
        RAISE EXCEPTION 'target check failed: Farm id=farm_demo-farmer-1 ownerId=demo-farmer-1 not found';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM reconcile_709_pond) THEN
        RAISE EXCEPTION 'target check failed: no Pond with ownerId=demo-farmer-1 and farmId=farm_demo-farmer-1';
    END IF;

    -- Scope completeness, ponds.
    SELECT count(*) INTO n
    FROM "Pond"
    WHERE "ownerId" = 'demo-farmer-1'
      AND "farmId" IS DISTINCT FROM 'farm_demo-farmer-1';
    IF n > 0 THEN
        RAISE EXCEPTION 'scope check failed: % Pond row(s) owned by demo-farmer-1 carry another farmId', n;
    END IF;

    -- Scope completeness, telemetry. Both directions are checked so a device
    -- based mutation cannot miss a stamped row and cannot catch a foreign one.
    SELECT count(*) INTO n
    FROM "FeedEvent"
    WHERE "farmId" = 'farm_demo-farmer-1'
      AND "deviceId" NOT IN (SELECT id FROM reconcile_709_device);
    IF n > 0 THEN
        RAISE EXCEPTION 'scope check failed: % FeedEvent row(s) stamped demo use a device outside the tenant ponds', n;
    END IF;

    SELECT count(*) INTO n
    FROM "FeedEvent"
    WHERE "deviceId" IN (SELECT id FROM reconcile_709_device)
      AND "farmId" IS DISTINCT FROM 'farm_demo-farmer-1';
    IF n > 0 THEN
        RAISE EXCEPTION 'scope check failed: % FeedEvent row(s) on demo devices are not stamped demo', n;
    END IF;

    SELECT count(*) INTO n
    FROM "FeedLevelLog"
    WHERE "farmId" = 'farm_demo-farmer-1'
      AND "deviceId" NOT IN (SELECT id FROM reconcile_709_device);
    IF n > 0 THEN
        RAISE EXCEPTION 'scope check failed: % FeedLevelLog row(s) stamped demo use a device outside the tenant ponds', n;
    END IF;

    SELECT count(*) INTO n
    FROM "FeedLevelLog"
    WHERE "deviceId" IN (SELECT id FROM reconcile_709_device)
      AND "farmId" IS DISTINCT FROM 'farm_demo-farmer-1';
    IF n > 0 THEN
        RAISE EXCEPTION 'scope check failed: % FeedLevelLog row(s) on demo devices are not stamped demo', n;
    END IF;

    SELECT count(*) INTO n
    FROM "DeviceStateEvent"
    WHERE "farmId" = 'farm_demo-farmer-1'
      AND "deviceId" NOT IN (SELECT id FROM reconcile_709_device);
    IF n > 0 THEN
        RAISE EXCEPTION 'scope check failed: % DeviceStateEvent row(s) stamped demo use a device outside the tenant ponds', n;
    END IF;

    SELECT count(*) INTO n
    FROM "DeviceStateEvent"
    WHERE "deviceId" IN (SELECT id FROM reconcile_709_device)
      AND "farmId" IS DISTINCT FROM 'farm_demo-farmer-1';
    IF n > 0 THEN
        RAISE EXCEPTION 'scope check failed: % DeviceStateEvent row(s) on demo devices are not stamped demo', n;
    END IF;

    -- Scope completeness, pond-keyed tables.
    SELECT count(*) INTO n
    FROM "FcrReport"
    WHERE "farmId" = 'farm_demo-farmer-1'
      AND "pondId" NOT IN (SELECT id FROM reconcile_709_pond);
    IF n > 0 THEN
        RAISE EXCEPTION 'scope check failed: % FcrReport row(s) stamped demo belong to a pond outside the tenant', n;
    END IF;

    SELECT count(*) INTO n
    FROM "FcrReport"
    WHERE "pondId" IN (SELECT id FROM reconcile_709_pond)
      AND "farmId" IS DISTINCT FROM 'farm_demo-farmer-1';
    IF n > 0 THEN
        RAISE EXCEPTION 'scope check failed: % FcrReport row(s) on demo ponds are not stamped demo', n;
    END IF;

    SELECT count(*) INTO n
    FROM "ScheduleCommand"
    WHERE "farmId" = 'farm_demo-farmer-1'
      AND "pondId" NOT IN (SELECT id FROM reconcile_709_pond);
    IF n > 0 THEN
        RAISE EXCEPTION 'scope check failed: % ScheduleCommand row(s) stamped demo belong to a pond outside the tenant', n;
    END IF;

    SELECT count(*) INTO n
    FROM "ScheduleCommand"
    WHERE "pondId" IN (SELECT id FROM reconcile_709_pond)
      AND "farmId" IS DISTINCT FROM 'farm_demo-farmer-1';
    IF n > 0 THEN
        RAISE EXCEPTION 'scope check failed: % ScheduleCommand row(s) on demo ponds are not stamped demo', n;
    END IF;

    -- The hopper model needs a capacity. Refuse rather than invent one.
    IF EXISTS (
        SELECT 1
        FROM reconcile_709_device d
        WHERE d.pond_status = 'ACTIVE'
          AND EXISTS (SELECT 1 FROM "FeedLevelLog" l WHERE l."deviceId" = d.id)
          AND (d.capacity_g IS NULL OR d.capacity_g <= 0)
    ) THEN
        RAISE EXCEPTION 'model check failed: an active demo device has level history but no hopperCapacityG';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM reconcile_709_device d
        WHERE d.pond_status = 'ACTIVE'
          AND d.capacity_g > 0
          AND EXISTS (SELECT 1 FROM "FeedLevelLog" l WHERE l."deviceId" = d.id)
    ) THEN
        RAISE EXCEPTION 'model check failed: no active demo device has both level history and a hopper capacity';
    END IF;

    -- The percent-to-distance mapping below assumes empty > full. Refuse a
    -- device whose calibration is inverted instead of producing nonsense cm.
    IF EXISTS (
        SELECT 1
        FROM reconcile_709_device d
        WHERE d.pond_status = 'ACTIVE'
          AND d.capacity_g > 0
          AND coalesce(d.empty_cm, 30) <= coalesce(d.full_cm, 5)
    ) THEN
        RAISE EXCEPTION 'model check failed: an active demo device has emptyCm <= fullCm';
    END IF;
END;
$$;

INSERT INTO reconcile_709_log (step, affected, note)
SELECT 'baseline: demo FeedEvent rows', feed_rows, NULL FROM reconcile_709_baseline
UNION ALL
SELECT 'baseline: demo FeedLevelLog rows', level_rows, NULL FROM reconcile_709_baseline
UNION ALL
SELECT 'baseline: hand_fed grams', 0, handfed_g::text FROM reconcile_709_baseline;

-- -----------------------------------------------------------------------------
-- 1. hand_fed: one row per farm day
-- -----------------------------------------------------------------------------
--
-- Contract: lib/feed-figures.ts ("one row is a whole day"), lib/pond-charts.ts
-- and lib/chat/context.ts. The sheet import wrote two half-day rows per day
-- (08:00 and 16:00 Asia/Manila), 132 rows over 66 days. The sums are right;
-- only the row count and the per-row plots are doubled.
--
-- Survivor rule: the earliest "receivedAt" in the Asia/Manila farm day, with
-- the lowest id as a deterministic tie-break. That row keeps its original
-- timestamp (we do not invent a time) and its grams become the SUM of every
-- hand_fed row in that farm day. The later rows are then deleted. Summing,
-- rather than simply dropping one, is deliberate: dropping would halve the
-- day's feed and silently change every total the sheet asserts.
--
-- Asia/Manila is the farm day used by startOfFarmDay() and by the audit SQL in
-- #709. The double AT TIME ZONE is required because the column is a naive UTC
-- timestamp, not a timestamptz.

-- The merge is per (device, farm day). Two ponds must never be folded into one
-- daily total just because the import used the same calendar day.
CREATE TEMP TABLE reconcile_709_handfed_plan ON COMMIT DROP AS
WITH multi_row_day AS (
    SELECT e."deviceId" AS device_id,
           ((e."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date AS farm_day,
           count(*) AS row_count,
           sum(coalesce(e.grams, 0))::numeric AS total_g
    FROM "FeedEvent" e
    WHERE e.source = 'hand_fed'
      AND e."deviceId" IN (SELECT id FROM reconcile_709_device)
    GROUP BY e."deviceId", ((e."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date
    HAVING count(*) > 1
)
SELECT m.device_id,
       m.farm_day,
       m.row_count,
       m.total_g,
       (
           SELECT e.id
           FROM "FeedEvent" e
           WHERE e.source = 'hand_fed'
             AND e."deviceId" = m.device_id
             AND ((e."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date = m.farm_day
           ORDER BY e."receivedAt" ASC, e.id ASC
           LIMIT 1
       ) AS survivor_id
FROM multi_row_day m;

-- 1a. The survivor carries the day's total.
WITH updated AS (
    UPDATE "FeedEvent" e
    SET grams = p.total_g::double precision
    FROM reconcile_709_handfed_plan p
    WHERE e.id = p.survivor_id
      AND e.grams IS DISTINCT FROM p.total_g::double precision
    RETURNING 1
)
INSERT INTO reconcile_709_log (step, affected)
SELECT 'hand_fed: survivor grams set to the farm-day total', count(*) FROM updated;

-- 1b. Remove the duplicate rows of the same farm day.
WITH deleted AS (
    DELETE FROM "FeedEvent" e
    USING reconcile_709_handfed_plan p
    WHERE e.source = 'hand_fed'
      AND e."deviceId" IN (SELECT id FROM reconcile_709_device)
      AND e."deviceId" = p.device_id
      AND e.id <> p.survivor_id
      AND ((e."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date = p.farm_day
    RETURNING 1
)
INSERT INTO reconcile_709_log (step, affected)
SELECT 'hand_fed: duplicate rows removed', count(*) FROM deleted;

-- -----------------------------------------------------------------------------
-- 2. FeedLevelLog: backfill only days with no reading
-- -----------------------------------------------------------------------------
--
-- Why a model and not a random series: #709 G1 shows the seeded level series
-- stepped 1.8 % per reading while the feed log dispensed 4 x 1,500 g/day. The
-- two were generated independently (prisma/seed.ts). A backfill is only useful
-- if it is derived from the feed the device actually recorded, so this uses the
-- same relation the audit used:
--
--   mass balance:  level_g(t) = C - mod((C - level_g(anchor)) + F(anchor, t], C)
--
--   C              = EnergyDevice.hopperCapacityG (the audit verifies 4,659 g)
--   level_g(anchor)= the last real reading before the gap, as a mass
--   F(anchor, t]   = SUM(FeedEvent.grams) for machine dispenses only
--                    (source in scheduled / dashboard / button; hand_fed never
--                    passes through the hopper)
--   mod(..., C)    = a refill to full whenever the hopper would run empty. This
--                    is the refill term: every gram dispensed is accounted for,
--                    and the series returns to 100 % exactly at each refill.
--
-- Sanity check of the relation: one 1,500 g dispense is 32.2 % of a 4,659 g
-- hopper, not the 1.8 % the old fixture stepped by. Only 2026-10-28 reconciled
-- in the audit (3,101 g dispensed vs 3,265 g drop); this model reproduces that
-- relation for every day it fills.
--
-- The percent maps to the sensor distance with the device's own calibration:
--   distanceCm = emptyCm - (levelPercent / 100) * (emptyCm - fullCm)
-- and is clamped to [fullCm, emptyCm].
--
-- Anchor: the latest reading before the missing farm day (any provenance,
-- including an earlier synthetic batch, so the series stays continuous). A gap
-- at the very start of the history has no anchor and starts at 100 % of the
-- first day, which is stated here rather than hidden.
--
-- Readings are placed at 01:00, 07:00, 13:00 and 19:00 Asia/Manila on the
-- missing farm day, converted to the naive UTC the column stores (17:00 and
-- 23:00 UTC on the previous date, 05:00 and 11:00 UTC on the day). All four
-- instants therefore belong to the same Manila day the coverage check counts,
-- and each one is anchored to the latest real reading before that instant.
-- The measured 2026-11-04 state had 11 missing days, so this plans 44 readings
-- (11 x 4); the plan is derived from the data, not hardcoded.
--
-- Idempotency: only farm days with zero FeedLevelLog rows are planned. A day
-- that already has a reading is never rewritten, including a day another
-- operator backfilled by hand. The script never overwrites existing history;
-- it only fills holes.

CREATE TEMP TABLE reconcile_709_level_plan ON COMMIT DROP AS
WITH active_device AS (
    SELECT d.id AS device_id,
           d.capacity_g,
           coalesce(d.full_cm, 5)::numeric AS full_cm,
           coalesce(d.empty_cm, 30)::numeric AS empty_cm
    FROM reconcile_709_device d
    WHERE d.pond_status = 'ACTIVE'
      AND d.capacity_g IS NOT NULL
      AND d.capacity_g > 0
),
span AS (
    SELECT l."deviceId" AS device_id,
           min((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date AS lo,
           max((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date AS hi
    FROM "FeedLevelLog" l
    WHERE l."deviceId" IN (SELECT device_id FROM active_device)
    GROUP BY 1
),
missing_day AS (
    SELECT s.device_id,
           s.lo,
           g::date AS farm_day
    FROM span s
    CROSS JOIN LATERAL generate_series(s.lo::timestamp, s.hi::timestamp, interval '1 day') g
    WHERE NOT EXISTS (
        SELECT 1
        FROM "FeedLevelLog" l
        WHERE l."deviceId" = s.device_id
          AND ((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date = g::date
    )
),
reading_time AS (
    SELECT m.device_id,
           m.lo,
           m.farm_day,
           h.hour_manila,
           (m.farm_day::timestamp + (h.hour_manila * interval '1 hour') - interval '8 hours') AS recorded_at
    FROM missing_day m
    CROSS JOIN (VALUES (1), (7), (13), (19)) AS h(hour_manila)
),
anchored AS (
    SELECT r.device_id,
           r.lo,
           r.farm_day,
           r.recorded_at,
           a.anchor_at,
           a.anchor_pct
    FROM reading_time r
    LEFT JOIN LATERAL (
        SELECT l."recordedAt" AS anchor_at,
               l."levelPercent"::numeric AS anchor_pct
        FROM "FeedLevelLog" l
        WHERE l."deviceId" = r.device_id
          AND l."recordedAt" < r.recorded_at
        ORDER BY l."recordedAt" DESC
        LIMIT 1
    ) a ON true
),
modelled AS (
    SELECT a.device_id,
           a.farm_day,
           a.recorded_at,
           ad.capacity_g,
           ad.full_cm,
           ad.empty_cm,
           least(100::numeric, greatest(0::numeric, coalesce(a.anchor_pct, 100::numeric))) AS anchor_pct,
           coalesce(
               (
                   SELECT sum(e.grams)
                   FROM "FeedEvent" e
                   WHERE e."deviceId" = a.device_id
                     AND e."eventType" = 'feed_dispensed'
                     AND e.source IN ('scheduled', 'dashboard', 'button')
                     AND e.grams IS NOT NULL
                     AND e."receivedAt" > coalesce(a.anchor_at, a.lo::timestamp - interval '8 hours')
                     AND e."receivedAt" <= a.recorded_at
               ),
               0
           )::numeric AS feed_g
    FROM anchored a
    JOIN active_device ad ON ad.device_id = a.device_id
),
calc AS (
    SELECT m.device_id,
           m.farm_day,
           m.recorded_at,
           m.capacity_g,
           m.full_cm,
           m.empty_cm,
           m.capacity_g
             - mod(
                   (m.capacity_g - (m.anchor_pct / 100.0) * m.capacity_g) + m.feed_g,
                   m.capacity_g
               ) AS level_g
    FROM modelled m
)
SELECT c.device_id,
       c.farm_day,
       c.recorded_at,
       round(greatest(0::numeric, least(100::numeric, (c.level_g / c.capacity_g) * 100.0)), 2) AS level_percent,
       round(
           greatest(
               c.full_cm,
               least(
                   c.empty_cm,
                   c.empty_cm - (c.level_g / c.capacity_g) * (c.empty_cm - c.full_cm)
               )
           ),
           2
       ) AS distance_cm
FROM calc c;

CREATE TEMP TABLE reconcile_709_level_inserted (
    id text PRIMARY KEY
) ON COMMIT DROP;

WITH inserted AS (
    INSERT INTO "FeedLevelLog" (
        "id",
        "deviceId",
        "levelPercent",
        "distanceCm",
        "recordedAt",
        "dataSource",
        "farmId"
    )
    SELECT gen_random_uuid()::text,
           p.device_id,
           p.level_percent,
           p.distance_cm,
           p.recorded_at,
           'synthetic',
           'farm_demo-farmer-1'
    FROM reconcile_709_level_plan p
    WHERE NOT EXISTS (
        SELECT 1
        FROM "FeedLevelLog" l
        WHERE l."deviceId" = p.device_id
          AND l."recordedAt" = p.recorded_at
    )
    RETURNING id
)
INSERT INTO reconcile_709_level_inserted (id)
SELECT id FROM inserted;

INSERT INTO reconcile_709_log (step, affected, note)
SELECT 'FeedLevelLog: model readings inserted',
       count(*),
       'dataSource=synthetic; days that already had a reading were left untouched'
FROM reconcile_709_level_inserted;

-- -----------------------------------------------------------------------------
-- 3. The 2000-01-01 heartbeats (audit saw 3; measured 2 on 2026-11-04)
-- -----------------------------------------------------------------------------
--
-- Decision: set rtcOk = false and KEEP the rows. Do not invent a time and do
-- not delete them.
--
-- Why keep: seed.ts / seed-dev.ts never write heartbeat rows, so these are real
-- device heartbeats from an ESP32 whose RTC had not been set. The 2000-01-01
-- value is the unset-clock epoch (9,799 days before the data), not a fixture.
-- Deleting them would destroy the only evidence that the device booted without
-- a clock. The issue's own Expected item says "Fix rtcOk", not "delete".
--
-- Why not rewrite the timestamp: any replacement time would be invented. The
-- row records what the device sent; rtcOk=false is the field that tells every
-- consumer the device time is untrustworthy. The audit's analytics must ignore
-- the timestamp, not be handed a fabricated one.
--
-- This is why verify.sql checks "0 year-2000 rows with rtcOk = true" and
-- reports the 3 preserved rows separately. A literal "0 rows with a year-2000
-- timestamp" would require deleting real telemetry.

CREATE TEMP TABLE reconcile_709_rtc_pre ON COMMIT DROP AS
SELECT e.id,
       e."rtcOk" AS previous
FROM "FeedEvent" e
WHERE e."deviceId" IN (SELECT id FROM reconcile_709_device)
  AND e."eventType" = 'heartbeat'
  AND e."timestamp" LIKE '2000-01-01%'
  AND e."rtcOk" IS DISTINCT FROM false;

CREATE TEMP TABLE reconcile_709_rtc_updated (
    id text PRIMARY KEY
) ON COMMIT DROP;

WITH updated AS (
    UPDATE "FeedEvent" e
    SET "rtcOk" = false
    WHERE e.id IN (SELECT id FROM reconcile_709_rtc_pre)
      AND e."rtcOk" IS DISTINCT FROM false
    RETURNING id
)
INSERT INTO reconcile_709_rtc_updated (id)
SELECT id FROM updated;

INSERT INTO reconcile_709_log (step, affected, note)
SELECT 'FeedEvent: 2000-01-01 heartbeats marked rtcOk=false',
       count(*),
       'matched at transaction start: ' || (SELECT count(*) FROM reconcile_709_rtc_pre)::text
FROM reconcile_709_rtc_updated;

-- -----------------------------------------------------------------------------
-- 4. FcrReport: decide, do not invent
-- -----------------------------------------------------------------------------
--
-- The six imported rows are left numerically unchanged. Recomputing them from
-- the logs is not possible without inventing data:
--
--   * the first three periods predate the Pond row and have 0 kg of FeedEvent
--     and no BiomassLog in the window (issue G2), so feed / gain is 0 / 0;
--   * writing 0 as fcrValue would violate fcrValue = totalFeedKg / biomassGainKg
--     and would be a fabricated number, not a repair;
--   * deleting them would erase the imported evidence and change the FCR feed
--     calculator's stored fallback, which the owner has not authorised.
--
-- The schema has no status / dataSource column on FcrReport and the readers do
-- not filter one, so a row-level "stale" flag is a schema change, not a data
-- repair. This script therefore records the staleness in the audit marker in
-- step 7 (metadata.fcrStale = true, with the exact per-report evidence) and
-- leaves the rows for the owner's decision. README.md states plainly that the
-- FCR page will keep showing them until a follow-up adds the flag or switches
-- the page to the computed path (#453).
--
-- This table is the evidence snapshot, not a mutation.

CREATE TEMP TABLE reconcile_709_fcr_pre ON COMMIT DROP AS
SELECT r.id,
       r."pondId",
       r."periodStart",
       r."periodEnd",
       r."totalFeedKg",
       r."biomassGainKg",
       r."fcrValue",
       coalesce(f.kg, 0)::numeric AS "feedEventKgInWindow",
       coalesce(b.n, 0) AS "biomassLogsInWindow",
       (coalesce(f.kg, 0) > 0 AND coalesce(b.n, 0) >= 2) AS "computableFromLogs",
       CASE
           WHEN r."biomassGainKg" > 0
           THEN abs(r."fcrValue" - r."totalFeedKg" / r."biomassGainKg") > 0.000001
           ELSE true
       END AS "identityViolation"
FROM "FcrReport" r
LEFT JOIN LATERAL (
    SELECT sum(e.grams) / 1000.0 AS kg
    FROM "FeedEvent" e
    WHERE e."deviceId" IN (SELECT id FROM reconcile_709_device)
      AND e."eventType" = 'feed_dispensed'
      AND e."receivedAt" >= r."periodStart"
      AND e."receivedAt" <= r."periodEnd"
) f ON true
LEFT JOIN LATERAL (
    SELECT count(*) AS n
    FROM "BiomassLog" bl
    WHERE bl."pondId" = r."pondId"
      AND bl."recordedAt" >= r."periodStart"
      AND bl."recordedAt" <= r."periodEnd"
) b ON true
WHERE r."pondId" IN (SELECT id FROM reconcile_709_pond);

INSERT INTO reconcile_709_log (step, affected, note)
SELECT 'FcrReport: rows left unchanged, marked stale in the audit marker',
       0,
       count(*)::text || ' report(s) inspected; ' ||
       count(*) FILTER (WHERE "identityViolation")::text ||
       ' identity violation(s), not repaired by design'
FROM reconcile_709_fcr_pre;

-- -----------------------------------------------------------------------------
-- 5. demo-pond-001: retire the stale seed pond
-- -----------------------------------------------------------------------------
--
-- G9: the seed calls it "Demo Pond", the live row is "Test Pond", ARCHIVED,
-- with gramsPerFeeding = 18 against 56 recorded 1,500 g dispenses, and one
-- ScheduleCommand still pending. The issue offers "retire or re-point".
--
-- Retire, because:
--   * the live demo surface is the other pond (cmtcr6jzk..., the one with the
--     285-fish history); reactivating a second pond would put a contradictory
--     56 kg seed series back on the reviewer's dashboard;
--   * an archived pond with a pending command and a live device is the actual
--     inconsistency, so the repair makes the archive coherent instead of
--     undoing it;
--   * seed-dev.ts is a developer fixture, not the production demo, and its code
--     fix is a separate follow-up (not this data script).
--
-- The device's dose is set to 1,500 g so its configuration matches the 56
-- recorded dispenses it already has. Rewriting the 56 events to 18 g would
-- change 56 kg of recorded history and is a larger, unauthorised rewrite.
-- The device is paused and the pending command fails closed: no schedule can
-- be picked up and applied to a retired pond.
--
-- A targeted undo of all three rows is in the audit marker's g9PreImage.

WITH updated AS (
    UPDATE "Pond" p
    SET name = 'Demo Pond (retired seed)',
        status = 'ARCHIVED',
        "isFallow" = true
    WHERE p.id = 'demo-pond-001'
      AND p."ownerId" = 'demo-farmer-1'
      AND p."farmId" = 'farm_demo-farmer-1'
      AND (
          p.name IS DISTINCT FROM 'Demo Pond (retired seed)'
          OR p.status IS DISTINCT FROM 'ARCHIVED'
          OR p."isFallow" IS DISTINCT FROM true
      )
    RETURNING 1
)
INSERT INTO reconcile_709_log (step, affected)
SELECT 'demo-pond-001: renamed, archived and marked fallow', count(*) FROM updated;

WITH updated AS (
    UPDATE "EnergyDevice" d
    SET "gramsPerFeeding" = 1500,
        "isPaused" = true,
        "feederActive" = false
    WHERE d."pondId" = 'demo-pond-001'
      AND d."pondId" IN (SELECT id FROM reconcile_709_pond)
      AND EXISTS (
          SELECT 1 FROM "FeedEvent" e
          WHERE e."deviceId" = d.id
            AND e."eventType" = 'feed_dispensed'
            AND e."grams" = 1500
      )
      AND (
          d."gramsPerFeeding" IS DISTINCT FROM 1500
          OR d."isPaused" IS DISTINCT FROM true
          OR d."feederActive" IS DISTINCT FROM false
      )
    RETURNING 1
)
INSERT INTO reconcile_709_log (step, affected)
SELECT 'demo-pond-001: device dose set to the recorded 1,500 g and paused', count(*) FROM updated;

WITH updated AS (
    UPDATE "ScheduleCommand" c
    SET status = 'failed',
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE c."pondId" = 'demo-pond-001'
      AND c."pondId" IN (SELECT id FROM reconcile_709_pond)
      AND c.status IN ('pending', 'sent')
    RETURNING 1
)
INSERT INTO reconcile_709_log (step, affected)
SELECT 'demo-pond-001: pending schedule command failed closed', count(*) FROM updated;

-- -----------------------------------------------------------------------------
-- 6. FeedEvent.dataSource: seeded and imported rows are not device telemetry
-- -----------------------------------------------------------------------------
--
-- G7 at filing: all 556 demo FeedEvents were dataSource='device', including
-- 112 seed rows at exactly 1,500 g and the 132 imported hand_fed rows. The
-- measured 2026-11-04 state is 512 FeedEvents: 112 seed, 132 import, 252 device
-- and 16 synthetic. The seed and import targets are therefore 0 on that state;
-- the derived sets are still built so a fresh database with untagged rows is
-- repaired, and the guards prove zero untagged rows remain.
--
-- Seed rule: a feed_dispensed row at exactly 1,500 g whose linked FeedRequest
-- is also 1,500 g, completed, and was created at the same instant as the event
-- receivedAt. That is exactly how prisma/seed.ts and seed-dev.ts build their
-- fixtures (a request per event, createdAt = event receivedAt), so it selects
-- the 56 + 56 seed rows without guessing from the amount alone.
--
-- Import rule: every surviving hand_fed row. The merge above already removed
-- the duplicate rows (132 measured -> 66 survivors). The deletion is the
-- row-count correction; provenance is the label.
--
-- The 16 synthetic rows are the W5 fill from the 2026-11-04 batch. They are
-- neither the 1,500 g seed fixture nor hand_fed, so they are in neither derived
-- set and are left alone. Do not silently retag them.
--
-- Nothing in the app filters on dataSource today (verified by reading
-- lib/**/*.ts), so this does not hide demo history from any screen. It makes
-- the future audit possible.

-- The full seed-shaped set is derived regardless of its current dataSource,
-- so the guard can prove that zero rows in that set are still untagged. The
-- update only touches rows that still say `device`; an already-`seed` (or a
-- `synthetic`) row is never silently relabelled.
CREATE TEMP TABLE reconcile_709_seed_set ON COMMIT DROP AS
SELECT e.id
FROM "FeedEvent" e
WHERE e."deviceId" IN (SELECT id FROM reconcile_709_device)
  AND e."eventType" = 'feed_dispensed'
  AND e."grams" = 1500
  AND EXISTS (
      SELECT 1
      FROM "FeedRequest" r
      WHERE r.id = e."feedRequestId"
        AND r."deviceId" = e."deviceId"
        AND r."grams" = 1500
        AND r."status" = 'completed'
        AND r."createdAt" = e."receivedAt"
  );

CREATE TEMP TABLE reconcile_709_seed_ids ON COMMIT DROP AS
SELECT e.id
FROM "FeedEvent" e
WHERE e.id IN (SELECT id FROM reconcile_709_seed_set)
  AND e."dataSource" = 'device';

CREATE TEMP TABLE reconcile_709_seed_updated (
    id text PRIMARY KEY
) ON COMMIT DROP;

WITH updated AS (
    UPDATE "FeedEvent" e
    SET "dataSource" = 'seed'
    WHERE e.id IN (SELECT id FROM reconcile_709_seed_ids)
    RETURNING id
)
INSERT INTO reconcile_709_seed_updated (id)
SELECT id FROM updated;

INSERT INTO reconcile_709_log (step, affected, note)
SELECT 'FeedEvent: seed fixtures tagged dataSource=seed',
       count(*),
       'untagged seed-shaped rows before this run: ' || (SELECT count(*) FROM reconcile_709_seed_ids)::text
FROM reconcile_709_seed_updated;

-- Snapshot AFTER the merge, so the set contains the 66 surviving rows. The
-- full set is derived regardless of its current dataSource; the update only
-- targets rows still saying `device`. A synthetic row is never relabelled.
CREATE TEMP TABLE reconcile_709_import_set ON COMMIT DROP AS
SELECT e.id
FROM "FeedEvent" e
WHERE e.source = 'hand_fed'
  AND e."deviceId" IN (SELECT id FROM reconcile_709_device);

CREATE TEMP TABLE reconcile_709_import_ids ON COMMIT DROP AS
SELECT e.id
FROM "FeedEvent" e
WHERE e.id IN (SELECT id FROM reconcile_709_import_set)
  AND e."dataSource" = 'device';

CREATE TEMP TABLE reconcile_709_import_updated (
    id text PRIMARY KEY
) ON COMMIT DROP;

WITH updated AS (
    UPDATE "FeedEvent" e
    SET "dataSource" = 'import'
    WHERE e.id IN (SELECT id FROM reconcile_709_import_ids)
    RETURNING id
)
INSERT INTO reconcile_709_import_updated (id)
SELECT id FROM updated;

INSERT INTO reconcile_709_log (step, affected, note)
SELECT 'FeedEvent: imported hand_fed rows tagged dataSource=import',
       count(*),
       'untagged hand_fed rows before this run: ' || (SELECT count(*) FROM reconcile_709_import_ids)::text
FROM reconcile_709_import_updated;

-- -----------------------------------------------------------------------------
-- 7. Audit marker, assertions, commit
-- -----------------------------------------------------------------------------
--
-- One DeviceStateEvent carries the complete undo log: the deleted hand_fed
-- rows, the merged survivors, the inserted level ids, the rtcOk ids, the
-- demo-pond-001 pre-image, the provenance id lists and the FCR evidence. It is
-- written once (the NOT EXISTS guard makes a re-run a no-op), so it is also the
-- durable proof that this reconciliation ran.

CREATE TEMP TABLE reconcile_709_marker (
    id text PRIMARY KEY
) ON COMMIT DROP;

WITH marker AS (
    INSERT INTO "DeviceStateEvent" (
        "id",
        "deviceId",
        "eventType",
        "source",
        "actorId",
        "metadata",
        "deviceTime",
        "createdAt",
        "farmId"
    )
    SELECT gen_random_uuid()::text,
           d.id,
           'data_imported',
           'system',
           NULL,
           jsonb_build_object(
               'issue', 709,
               'kind', 'demo-history-reconcile',
               'fcrStale', true,
               'summary', 'Reconciled the demo tenant history: hand_fed merged to one row per farm day, missing level days modelled from machine dispenses, 2000-01-01 heartbeats untrusted, demo-pond-001 retired, seed/import provenance tagged. FCR reports left unchanged and marked stale.',
               'handFed', jsonb_build_object(
                   'gramsBefore', (SELECT handfed_g::numeric FROM reconcile_709_baseline),
                   'gramsAfter', (
                       SELECT coalesce(sum(e.grams), 0)::numeric
                       FROM "FeedEvent" e
                       WHERE e.source = 'hand_fed'
                         AND e."deviceId" IN (SELECT id FROM reconcile_709_device)
                   ),
                   'survivors', coalesce(
                       (
                           SELECT jsonb_agg(
                               jsonb_build_object(
                                   'deviceId', p.device_id,
                                   'id', p.survivor_id,
                                   'farmDay', p.farm_day,
                                   'gramsBefore', pre.grams,
                                   'gramsAfter', p.total_g
                               )
                               ORDER BY p.farm_day, p.device_id
                           )
                           FROM reconcile_709_handfed_plan p
                           LEFT JOIN reconcile_709_handfed_pre pre ON pre.id = p.survivor_id
                       ),
                       '[]'::jsonb
                   ),
                   'deleted', coalesce(
                       (
                           SELECT jsonb_agg(to_jsonb(pre) ORDER BY pre."receivedAt")
                           FROM reconcile_709_handfed_pre pre
                           JOIN reconcile_709_handfed_plan p
                             ON pre."deviceId" = p.device_id
                            AND ((pre."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date = p.farm_day
                           WHERE pre.id <> p.survivor_id
                       ),
                       '[]'::jsonb
                   )
               ),
               'levelLogIds', coalesce(
                   (SELECT jsonb_agg(id) FROM reconcile_709_level_inserted),
                   '[]'::jsonb
               ),
               'level', jsonb_build_object(
                   'missingDaysBefore', (
                       SELECT count(*)
                       FROM (
                           SELECT DISTINCT device_id, farm_day
                           FROM reconcile_709_level_plan
                       ) d
                   ),
                   'insertedRows', (SELECT count(*) FROM reconcile_709_level_inserted)
               ),
               'rtcOk', jsonb_build_object(
                   'matched', (SELECT count(*) FROM reconcile_709_rtc_pre),
                   'repaired', (SELECT count(*) FROM reconcile_709_rtc_updated),
                   'rows', coalesce(
                       (
                           SELECT jsonb_agg(jsonb_build_object('id', id, 'previous', previous))
                           FROM reconcile_709_rtc_pre
                       ),
                       '[]'::jsonb
                   )
               ),
               'g9PreImage', coalesce(
                   (
                       SELECT jsonb_agg(jsonb_build_object('kind', kind, 'row', payload))
                       FROM reconcile_709_g9_pre
                   ),
                   '[]'::jsonb
               ),
               'provenance', jsonb_build_object(
                   'seedTotal', (SELECT count(*) FROM reconcile_709_seed_set),
                   'importTotal', (SELECT count(*) FROM reconcile_709_import_set),
                   'seedEventIds', coalesce((SELECT jsonb_agg(id) FROM reconcile_709_seed_ids), '[]'::jsonb),
                   'importEventIds', coalesce((SELECT jsonb_agg(id) FROM reconcile_709_import_ids), '[]'::jsonb),
                   'currentSplit', coalesce(
                       (
                           SELECT jsonb_object_agg(s."dataSource", s.n)
                           FROM (
                               SELECT e."dataSource", count(*) AS n
                               FROM "FeedEvent" e
                               WHERE e."deviceId" IN (SELECT id FROM reconcile_709_device)
                               GROUP BY 1
                           ) s
                       ),
                       '{}'::jsonb
                   )
               ),
               'fcrIdentityViolations', (
                   SELECT count(*) FROM reconcile_709_fcr_pre WHERE "identityViolation"
               ),
               'fcrReports', coalesce(
                   (
                       SELECT jsonb_agg(to_jsonb(f) ORDER BY f."periodStart")
                       FROM reconcile_709_fcr_pre f
                   ),
                   '[]'::jsonb
               ),
               'appliedAtUtc', to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
           ),
           NULL,
           (now() AT TIME ZONE 'UTC'),
           'farm_demo-farmer-1'
    FROM (
        SELECT d.id
        FROM reconcile_709_device d
        JOIN "Pond" p ON p.id = d.pond_id
        WHERE p.status = 'ACTIVE'
        ORDER BY (SELECT count(*) FROM "FeedEvent" e WHERE e."deviceId" = d.id) DESC, d.id
        LIMIT 1
    ) d
    WHERE NOT EXISTS (
        SELECT 1
        FROM "DeviceStateEvent" x
        WHERE x."eventType" = 'data_imported'
          AND x."farmId" = 'farm_demo-farmer-1'
          AND x.metadata ->> 'issue' = '709'
          AND x.metadata ->> 'kind' = 'demo-history-reconcile'
    )
    RETURNING id
)
INSERT INTO reconcile_709_marker (id)
SELECT id FROM marker;

INSERT INTO reconcile_709_log (step, affected)
SELECT 'DeviceStateEvent: audit marker written (0 on a re-run)', count(*)
FROM reconcile_709_marker;

-- Show the log before the assertions: if an assertion aborts the transaction,
-- the client still sees exactly which mutations were attempted.
SELECT ord, step, affected, note
FROM reconcile_709_log
ORDER BY ord;

DO $$
DECLARE
    n bigint;
    m bigint;
    before_g numeric;
    after_g numeric;
BEGIN
    -- 1. hand_fed: zero duplicate (device, farm day) groups; the surviving row
    --    count equals the distinct farm-day count; the tenant total is preserved
    --    within 1 mg (floating-point sums are not associative).
    SELECT count(*) INTO n
    FROM (
        SELECT 1
        FROM "FeedEvent" e
        WHERE e.source = 'hand_fed'
          AND e."deviceId" IN (SELECT id FROM reconcile_709_device)
        GROUP BY e."deviceId", ((e."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date
        HAVING count(*) > 1
    ) duplicated;
    IF n > 0 THEN
        RAISE EXCEPTION 'assertion failed: % hand_fed (device, farm day) group(s) still hold more than one row', n;
    END IF;

    SELECT count(*) INTO n
    FROM "FeedEvent" e
    WHERE e.source = 'hand_fed'
      AND e."deviceId" IN (SELECT id FROM reconcile_709_device);

    SELECT count(*) INTO m
    FROM (
        SELECT DISTINCT e."deviceId",
               ((e."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date
        FROM "FeedEvent" e
        WHERE e.source = 'hand_fed'
          AND e."deviceId" IN (SELECT id FROM reconcile_709_device)
    ) d;
    IF n <> m THEN
        RAISE EXCEPTION 'assertion failed: % hand_fed row(s) for % distinct (device, farm day) group(s)', n, m;
    END IF;

    SELECT b.handfed_g::numeric INTO before_g FROM reconcile_709_baseline b;
    SELECT coalesce(sum(e.grams), 0)::numeric INTO after_g
    FROM "FeedEvent" e
    WHERE e.source = 'hand_fed'
      AND e."deviceId" IN (SELECT id FROM reconcile_709_device);
    IF abs(after_g - before_g) > 0.001 THEN
        RAISE EXCEPTION 'assertion failed: hand_fed grams changed from % to %', before_g, after_g;
    END IF;

    -- 2. Level: the insert affected every planned row, the plan is exactly four
    --    readings per missing farm day, every planned day now has a reading, and
    --    no day in the active span is empty.
    SELECT count(*) INTO n FROM reconcile_709_level_inserted;
    SELECT count(*) INTO m FROM reconcile_709_level_plan;
    IF n <> m THEN
        RAISE EXCEPTION 'assertion failed: level insert affected % row(s) but the plan had %', n, m;
    END IF;

    SELECT count(*) INTO n FROM reconcile_709_level_plan;
    SELECT count(*) INTO m
    FROM (SELECT DISTINCT device_id, farm_day FROM reconcile_709_level_plan) d;
    IF n <> 4 * m THEN
        RAISE EXCEPTION 'assertion failed: level plan has % row(s) for % missing day(s), expected 4 per day', n, m;
    END IF;

    SELECT count(*) INTO n
    FROM (SELECT DISTINCT device_id, farm_day FROM reconcile_709_level_plan) p
    WHERE NOT EXISTS (
        SELECT 1
        FROM "FeedLevelLog" l
        WHERE l."deviceId" = p.device_id
          AND ((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date = p.farm_day
    );
    IF n > 0 THEN
        RAISE EXCEPTION 'assertion failed: % planned level day(s) still have no reading', n;
    END IF;

    SELECT count(*) INTO n
    FROM (
        SELECT s.device_id, s.lo, s.hi
        FROM (
            SELECT l."deviceId" AS device_id,
                   min((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date AS lo,
                   max((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date AS hi
            FROM "FeedLevelLog" l
            WHERE l."deviceId" IN (
                SELECT d.id FROM reconcile_709_device d
                WHERE d.pond_status = 'ACTIVE'
            )
            GROUP BY 1
        ) s
        CROSS JOIN LATERAL generate_series(s.lo::timestamp, s.hi::timestamp, interval '1 day') g
        WHERE NOT EXISTS (
            SELECT 1
            FROM "FeedLevelLog" l
            WHERE l."deviceId" = s.device_id
              AND ((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date = g::date
        )
    ) missing;
    IF n > 0 THEN
        RAISE EXCEPTION 'assertion failed: % missing level day(s) remain in the active demo span', n;
    END IF;

    -- 3. RTC: the repair count equals the start-of-transaction match count, and
    --    no matching row is still trusted.
    SELECT count(*) INTO n FROM reconcile_709_rtc_updated;
    SELECT count(*) INTO m FROM reconcile_709_rtc_pre;
    IF n <> m THEN
        RAISE EXCEPTION 'assertion failed: rtcOk repaired % row(s) but % matched at transaction start', n, m;
    END IF;

    SELECT count(*) INTO n
    FROM "FeedEvent" e
    WHERE e."deviceId" IN (SELECT id FROM reconcile_709_device)
      AND e."timestamp" LIKE '2000-01-01%'
      AND e."rtcOk" IS TRUE;
    IF n > 0 THEN
        RAISE EXCEPTION 'assertion failed: % 2000-01-01 row(s) still have rtcOk=true', n;
    END IF;

    -- 4. Provenance: every row in each derived set was tagged; zero remain
    --    untagged. The absolute set sizes are drift-prone and are not asserted.
    SELECT count(*) INTO n FROM reconcile_709_seed_updated;
    SELECT count(*) INTO m FROM reconcile_709_seed_ids;
    IF n <> m THEN
        RAISE EXCEPTION 'assertion failed: seed tagging updated % row(s) but % were targeted', n, m;
    END IF;

    SELECT count(*) INTO n
    FROM "FeedEvent" e
    WHERE e.id IN (SELECT id FROM reconcile_709_seed_set)
      AND e."dataSource" = 'device';
    IF n > 0 THEN
        RAISE EXCEPTION 'assertion failed: % seed-shaped row(s) remain untagged', n;
    END IF;

    SELECT count(*) INTO n FROM reconcile_709_import_updated;
    SELECT count(*) INTO m FROM reconcile_709_import_ids;
    IF n <> m THEN
        RAISE EXCEPTION 'assertion failed: import tagging updated % row(s) but % were targeted', n, m;
    END IF;

    SELECT count(*) INTO n
    FROM "FeedEvent" e
    WHERE e.id IN (SELECT id FROM reconcile_709_import_set)
      AND e."dataSource" = 'device';
    IF n > 0 THEN
        RAISE EXCEPTION 'assertion failed: % hand_fed row(s) remain untagged', n;
    END IF;

    -- 5. demo-pond-001 is retired, has no pending/sent command, and its feeder
    --    configuration matches its recorded 1,500 g dispenses.
    IF EXISTS (
        SELECT 1 FROM "Pond"
        WHERE id = 'demo-pond-001'
          AND "ownerId" = 'demo-farmer-1'
          AND (
              status IS DISTINCT FROM 'ARCHIVED'
              OR "isFallow" IS DISTINCT FROM true
              OR name IS DISTINCT FROM 'Demo Pond (retired seed)'
          )
    ) THEN
        RAISE EXCEPTION 'assertion failed: demo-pond-001 is not fully retired';
    END IF;

    SELECT count(*) INTO n
    FROM "ScheduleCommand" c
    WHERE c."pondId" = 'demo-pond-001'
      AND c."pondId" IN (SELECT id FROM reconcile_709_pond)
      AND c.status IN ('pending', 'sent');
    IF n > 0 THEN
        RAISE EXCEPTION 'assertion failed: demo-pond-001 still has % pending/sent command(s)', n;
    END IF;

    SELECT count(*) INTO n
    FROM "EnergyDevice" d
    WHERE d."pondId" = 'demo-pond-001'
      AND d."pondId" IN (SELECT id FROM reconcile_709_pond)
      AND EXISTS (
          SELECT 1 FROM "FeedEvent" e
          WHERE e."deviceId" = d.id
            AND e."eventType" = 'feed_dispensed'
            AND e."grams" = 1500
      )
      AND (
          d."gramsPerFeeding" IS DISTINCT FROM 1500
          OR d."isPaused" IS DISTINCT FROM true
          OR d."feederActive" IS DISTINCT FROM false
      );
    IF n > 0 THEN
        RAISE EXCEPTION 'assertion failed: % demo-pond-001 feeder(s) still have the wrong dose or pause state', n;
    END IF;

    -- 6. Exactly one audit marker for this run.
    SELECT count(*) INTO n
    FROM "DeviceStateEvent" x
    WHERE x."eventType" = 'data_imported'
      AND x."farmId" = 'farm_demo-farmer-1'
      AND x.metadata ->> 'issue' = '709'
      AND x.metadata ->> 'kind' = 'demo-history-reconcile';
    IF n <> 1 THEN
        RAISE EXCEPTION 'assertion failed: expected exactly 1 audit marker, found %', n;
    END IF;

    -- 7. Every row this run inserted is inside the tenant and inside 0..100 %.
    SELECT count(*) INTO n
    FROM "FeedLevelLog" l
    WHERE l.id IN (SELECT id FROM reconcile_709_level_inserted)
      AND (
          l."farmId" IS DISTINCT FROM 'farm_demo-farmer-1'
          OR l."levelPercent" < 0
          OR l."levelPercent" > 100
          OR l."deviceId" NOT IN (SELECT id FROM reconcile_709_device)
      );
    IF n > 0 THEN
        RAISE EXCEPTION 'assertion failed: % inserted level row(s) are outside the tenant or the 0..100 range', n;
    END IF;

    -- 8. FCR is deliberately not repaired. Report the measured contradiction;
    --    do not abort on it. The marker carries the same count and evidence.
    SELECT count(*) INTO n FROM reconcile_709_fcr_pre WHERE "identityViolation";
    RAISE NOTICE 'FcrReport identity violations: % (not repaired by design; see marker and README)', n;
END;
$$;

INSERT INTO reconcile_709_log (step, affected, note)
SELECT 'assertions passed; transaction is ready to commit', 0, NULL;

SELECT ord, step, affected, note
FROM reconcile_709_log
ORDER BY ord;

COMMIT;
