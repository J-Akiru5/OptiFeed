-- =============================================================================
-- #709 - verification queries for the demo tenant reconciliation
-- =============================================================================
--
-- READ ONLY. Every statement is a SELECT; this file changes nothing.
--
-- Run AFTER scripts/ops/demo-reconcile/reconcile.sql:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/ops/demo-reconcile/verify.sql
--
-- Before the reconcile, run dry-run.sql. This file is a set of POST-CONDITIONS:
-- the marker, the provenance tags and the demo-pond-001 retirement do not exist
-- before the repair, so a pre-run verify is expected to fail those checks.
--
-- The first result set is `PASS` / `FAIL` / `INFO`:
--   * PASS/FAIL is reserved for genuine post-repair invariants;
--   * INFO reports a drift-prone count and states the audit snapshot and, where
--     known, the measured 2026-11-04 pre-run value. An INFO row never fails the
--     repair because the tenant has been used since the audit.
--
-- Measured production pre-run state (2026-11-04 08:50Z, the run that rolled
-- back on the old absolute guard):
--   hand_fed 132 rows / 66 days / 42,046 g / 66 duplicates
--   FeedLevelLog 66 distinct days, 11 missing days in the audit span
--   year-2000 rows 2, both rtcOk=true
--   FcrReport 6 rows, 4 identity violations
--   demo-pond-001 retired 0, pending 1, device dose mismatch 1
--   FeedEvent 512: 112 seed, 132 import, 252 device, 16 synthetic
--   audit markers 0
--
-- Tenant scope is the same as reconcile.sql:
--   Pond.ownerId = 'demo-farmer-1' AND Pond.farmId = 'farm_demo-farmer-1'
--   telemetry is reached through the tenant's EnergyDevice rows.

SET TIME ZONE 'UTC';

WITH
tenant_pond AS (
    SELECT p.id
    FROM "Pond" p
    WHERE p."ownerId" = 'demo-farmer-1'
      AND p."farmId" = 'farm_demo-farmer-1'
),
tenant_device AS (
    SELECT d.id,
           d."pondId" AS pond_id,
           p.status::text AS pond_status
    FROM "EnergyDevice" d
    JOIN "Pond" p ON p.id = d."pondId"
    WHERE p.id IN (SELECT id FROM tenant_pond)
),
handfed AS (
    SELECT count(*) AS row_count,
           count(DISTINCT ((e."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date) AS day_count,
           coalesce(sum(e.grams), 0)::numeric AS grams
    FROM "FeedEvent" e
    WHERE e.source = 'hand_fed'
      AND e."deviceId" IN (SELECT id FROM tenant_device)
),
handfed_duplicate_group AS (
    SELECT count(*) AS n
    FROM (
        SELECT 1
        FROM "FeedEvent" e
        WHERE e.source = 'hand_fed'
          AND e."deviceId" IN (SELECT id FROM tenant_device)
        GROUP BY e."deviceId",
                 ((e."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date
        HAVING count(*) > 1
    ) duplicated
),
level_span AS (
    SELECT l."deviceId" AS device_id,
           min((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date AS lo,
           max((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date AS hi
    FROM "FeedLevelLog" l
    WHERE l."deviceId" IN (
        SELECT id FROM tenant_device WHERE pond_status = 'ACTIVE'
    )
    GROUP BY 1
),
missing_level AS (
    SELECT count(*) AS n
    FROM level_span s
    CROSS JOIN LATERAL generate_series(s.lo::timestamp, s.hi::timestamp, interval '1 day') g
    WHERE NOT EXISTS (
        SELECT 1
        FROM "FeedLevelLog" l
        WHERE l."deviceId" = s.device_id
          AND ((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date = g::date
    )
),
level_days AS (
    SELECT count(DISTINCT ((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date) AS n
    FROM "FeedLevelLog" l
    WHERE l."deviceId" IN (
        SELECT id FROM tenant_device WHERE pond_status = 'ACTIVE'
    )
),
rtc AS (
    SELECT count(*) FILTER (WHERE e."timestamp" LIKE '2000-01-01%') AS rows_2000,
           count(*) FILTER (
               WHERE e."timestamp" LIKE '2000-01-01%' AND e."rtcOk" IS TRUE
           ) AS trusted_2000
    FROM "FeedEvent" e
    WHERE e."deviceId" IN (SELECT id FROM tenant_device)
),
fcr AS (
    SELECT count(*) AS reports,
           count(*) FILTER (WHERE r."biomassGainKg" <= 0) AS zero_gain,
           count(*) FILTER (
               WHERE r."biomassGainKg" <= 0
                  OR CASE
                         WHEN r."biomassGainKg" > 0
                         THEN abs(r."fcrValue" - r."totalFeedKg" / r."biomassGainKg") > 0.000001
                         ELSE false
                     END
           ) AS identity_violations
    FROM "FcrReport" r
    WHERE r."pondId" IN (SELECT id FROM tenant_pond)
),
prov AS (
    SELECT
        count(*) FILTER (
            WHERE e."eventType" = 'feed_dispensed'
              AND e."grams" = 1500
              AND e."dataSource" = 'device'
              AND EXISTS (
                  SELECT 1
                  FROM "FeedRequest" r
                  WHERE r.id = e."feedRequestId"
                    AND r."deviceId" = e."deviceId"
                    AND r."grams" = 1500
                    AND r."status" = 'completed'
                    AND r."createdAt" = e."receivedAt"
              )
        ) AS seed_device,
        count(*) FILTER (
            WHERE e."eventType" = 'feed_dispensed'
              AND e."grams" = 1500
              AND EXISTS (
                  SELECT 1
                  FROM "FeedRequest" r
                  WHERE r.id = e."feedRequestId"
                    AND r."deviceId" = e."deviceId"
                    AND r."grams" = 1500
                    AND r."status" = 'completed'
                    AND r."createdAt" = e."receivedAt"
              )
        ) AS seed_total,
        count(*) FILTER (WHERE e.source = 'hand_fed' AND e."dataSource" = 'device') AS handfed_device,
        count(*) FILTER (WHERE e.source = 'hand_fed') AS import_total,
        count(*) FILTER (WHERE e."dataSource" = 'device') AS device_rows,
        count(*) FILTER (WHERE e."dataSource" = 'seed') AS seed_rows,
        count(*) FILTER (WHERE e."dataSource" = 'import') AS import_rows,
        count(*) FILTER (WHERE e."dataSource" = 'synthetic') AS synthetic_rows
    FROM "FeedEvent" e
    WHERE e."deviceId" IN (SELECT id FROM tenant_device)
),
g9 AS (
    SELECT
        (SELECT count(*) FROM "Pond"
          WHERE id = 'demo-pond-001' AND "ownerId" = 'demo-farmer-1') AS present,
        (SELECT count(*) FROM "Pond"
          WHERE id = 'demo-pond-001' AND "ownerId" = 'demo-farmer-1' AND status = 'ACTIVE') AS active,
        (SELECT count(*) FROM "Pond"
          WHERE id = 'demo-pond-001' AND "ownerId" = 'demo-farmer-1'
            AND status = 'ARCHIVED' AND "isFallow" = true
            AND name = 'Demo Pond (retired seed)') AS retired,
        (SELECT count(*) FROM "ScheduleCommand"
          WHERE "pondId" = 'demo-pond-001'
            AND "pondId" IN (SELECT id FROM tenant_pond)
            AND status IN ('pending', 'sent')) AS pending,
        (SELECT count(*) FROM "EnergyDevice"
          WHERE "pondId" = 'demo-pond-001'
            AND "pondId" IN (SELECT id FROM tenant_pond)
            AND "gramsPerFeeding" <> 1500) AS dose_mismatch
),
stamps AS (
    SELECT
        (SELECT count(*) FROM "FeedEvent"
          WHERE "deviceId" IN (SELECT id FROM tenant_device)
            AND "farmId" IS DISTINCT FROM 'farm_demo-farmer-1')
      + (SELECT count(*) FROM "FeedLevelLog"
          WHERE "deviceId" IN (SELECT id FROM tenant_device)
            AND "farmId" IS DISTINCT FROM 'farm_demo-farmer-1')
      + (SELECT count(*) FROM "DeviceStateEvent"
          WHERE "deviceId" IN (SELECT id FROM tenant_device)
            AND "farmId" IS DISTINCT FROM 'farm_demo-farmer-1')
      + (SELECT count(*) FROM "FcrReport"
          WHERE "pondId" IN (SELECT id FROM tenant_pond)
            AND "farmId" IS DISTINCT FROM 'farm_demo-farmer-1')
      + (SELECT count(*) FROM "ScheduleCommand"
          WHERE "pondId" IN (SELECT id FROM tenant_pond)
            AND "farmId" IS DISTINCT FROM 'farm_demo-farmer-1') AS bad
),
marker AS (
    SELECT count(*) AS n
    FROM "DeviceStateEvent" x
    WHERE x."eventType" = 'data_imported'
      AND x."farmId" = 'farm_demo-farmer-1'
      AND x.metadata ->> 'issue' = '709'
      AND x.metadata ->> 'kind' = 'demo-history-reconcile'
),
marker_meta AS (
    SELECT x.metadata
    FROM "DeviceStateEvent" x
    WHERE x."eventType" = 'data_imported'
      AND x."farmId" = 'farm_demo-farmer-1'
      AND x.metadata ->> 'issue' = '709'
      AND x.metadata ->> 'kind' = 'demo-history-reconcile'
    LIMIT 1
),
marker_handfed AS (
    SELECT (metadata -> 'handFed' ->> 'gramsBefore')::numeric AS grams_before,
           (metadata -> 'handFed' ->> 'gramsAfter')::numeric AS grams_after
    FROM marker_meta
),
marker_rtc AS (
    SELECT (metadata -> 'rtcOk' ->> 'matched')::bigint AS matched,
           (metadata -> 'rtcOk' ->> 'repaired')::bigint AS repaired
    FROM marker_meta
),
marker_level AS (
    SELECT (metadata -> 'level' ->> 'missingDaysBefore')::bigint AS missing_before,
           (metadata -> 'level' ->> 'insertedRows')::bigint AS inserted
    FROM marker_meta
),
marker_level_rows AS (
    SELECT l.id, l."levelPercent", l."deviceId", l."farmId"
    FROM "FeedLevelLog" l
    WHERE l.id IN (
        SELECT jsonb_array_elements_text(metadata -> 'levelLogIds')
        FROM marker_meta
    )
)
SELECT check_name, observed, expected, status
FROM (
    -- =========================================================================
    -- Post-repair invariants. These are the only rows allowed to FAIL.
    -- =========================================================================
    SELECT 1 AS ord,
           'hand_fed: duplicate (device, farm day) groups' AS check_name,
           (SELECT n FROM handfed_duplicate_group)::text AS observed,
           '0 (invariant)'::text AS expected,
           CASE WHEN (SELECT n FROM handfed_duplicate_group) = 0 THEN 'PASS' ELSE 'FAIL' END AS status

    UNION ALL
    SELECT 2,
           'hand_fed: rows equal distinct farm days',
           (SELECT row_count::text || ' rows / ' || day_count::text || ' days' FROM handfed),
           'equal (invariant)',
           CASE WHEN (SELECT row_count = day_count FROM handfed) THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 3,
           'hand_fed: grams preserved (marker before = after = current)',
           (SELECT grams::text FROM handfed),
           coalesce(
               (SELECT grams_before::text || ' -> ' || grams_after::text FROM marker_handfed),
               'marker missing'
           ),
           CASE
               WHEN (SELECT grams_before FROM marker_handfed) IS NOT NULL
                AND abs((SELECT grams FROM handfed) - (SELECT grams_after FROM marker_handfed)) <= 0.001
                AND abs((SELECT grams_before FROM marker_handfed) - (SELECT grams_after FROM marker_handfed)) <= 0.001
               THEN 'PASS'
               ELSE 'FAIL'
           END

    UNION ALL
    SELECT 4,
           'FeedLevelLog: missing farm days in the active demo span',
           (SELECT n FROM missing_level)::text,
           '0 (invariant)',
           CASE WHEN (SELECT n FROM missing_level) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 5,
           'FeedEvent: year-2000 timestamps with rtcOk = true',
           (SELECT trusted_2000 FROM rtc)::text,
           '0 (invariant)',
           CASE WHEN (SELECT trusted_2000 FROM rtc) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 6,
           'audit marker: DeviceStateEvent issue 709 rows',
           (SELECT n FROM marker)::text,
           '1 (invariant)',
           CASE WHEN (SELECT n FROM marker) = 1 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 7,
           'FeedEvent: seed-shaped rows still marked dataSource = device',
           (SELECT seed_device FROM prov)::text,
           '0 (invariant)',
           CASE WHEN (SELECT seed_device FROM prov) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 8,
           'FeedEvent: hand_fed rows still marked dataSource = device',
           (SELECT handfed_device FROM prov)::text,
           '0 (invariant)',
           CASE WHEN (SELECT handfed_device FROM prov) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 9,
           'farm stamp: demo rows with a null or wrong farmId',
           (SELECT bad FROM stamps)::text,
           '0 (invariant)',
           CASE WHEN (SELECT bad FROM stamps) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 10,
           'demo-pond-001: status ACTIVE',
           (SELECT active FROM g9)::text,
           '0 (invariant)',
           CASE WHEN (SELECT active FROM g9) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 11,
           'demo-pond-001: retired rows (name + ARCHIVED + fallow)',
           (SELECT retired FROM g9)::text,
           (SELECT present::text || ' present (invariant)' FROM g9),
           CASE WHEN (SELECT retired FROM g9) = (SELECT present FROM g9) THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 12,
           'demo-pond-001: pending or sent ScheduleCommand rows',
           (SELECT pending FROM g9)::text,
           '0 (invariant)',
           CASE WHEN (SELECT pending FROM g9) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 13,
           'demo-pond-001: devices whose gramsPerFeeding <> 1500',
           (SELECT dose_mismatch FROM g9)::text,
           '0 (invariant)',
           CASE WHEN (SELECT dose_mismatch FROM g9) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 14,
           'inserted level rows outside 0..100 % or the tenant',
           (SELECT count(*) FROM marker_level_rows
             WHERE "levelPercent" < 0
                OR "levelPercent" > 100
                OR "farmId" IS DISTINCT FROM 'farm_demo-farmer-1'
                OR "deviceId" NOT IN (SELECT id FROM tenant_device))::text,
           '0 (invariant)',
           CASE
               WHEN (SELECT count(*) FROM marker_level_rows
                      WHERE "levelPercent" < 0
                         OR "levelPercent" > 100
                         OR "farmId" IS DISTINCT FROM 'farm_demo-farmer-1'
                         OR "deviceId" NOT IN (SELECT id FROM tenant_device)) = 0 THEN 'PASS'
               ELSE 'FAIL'
           END

    UNION ALL
    SELECT 15,
           'rtcOk: repaired count equals the start-of-transaction match count',
           coalesce(
               (SELECT repaired::text || ' / ' || matched::text FROM marker_rtc),
               'marker missing'
           ),
           'equal (invariant)',
           CASE
               WHEN (SELECT repaired = matched FROM marker_rtc) THEN 'PASS'
               ELSE 'FAIL'
           END

    UNION ALL
    SELECT 16,
           'FeedLevelLog: inserted rows equal four per missing day at run start',
           coalesce(
               (SELECT inserted::text || ' / ' || missing_before::text || ' days' FROM marker_level),
               'marker missing'
           ),
           '4 per missing day (derived)',
           CASE
               WHEN (SELECT inserted = 4 * missing_before FROM marker_level) THEN 'PASS'
               ELSE 'FAIL'
           END

    -- =========================================================================
    -- Drift-prone counts. INFO only: the tenant has been used since the audit.
    -- =========================================================================
    UNION ALL
    SELECT 17,
           'hand_fed: rows (absolute count is drift-prone)',
           (SELECT row_count FROM handfed)::text,
           'audit 2026-11-03: 66; measured pre-run 2026-11-04: 132',
           'INFO'

    UNION ALL
    SELECT 18,
           'hand_fed: total grams (absolute value is drift-prone)',
           (SELECT grams::text FROM handfed),
           'audit 2026-11-03: 6,138; measured pre-run 2026-11-04: 42,046; invariant is preservation',
           'INFO'

    UNION ALL
    SELECT 19,
           'FeedLevelLog: distinct farm days (absolute count is drift-prone)',
           (SELECT n FROM level_days)::text,
           'audit 2026-11-03: 77; measured pre-run 2026-11-04: 66 (+11 filled)',
           'INFO'

    UNION ALL
    SELECT 20,
           'FeedEvent: year-2000 rows preserved (absolute count is drift-prone)',
           (SELECT rows_2000 FROM rtc)::text,
           'audit 2026-11-03: 3; measured pre-run 2026-11-04: 2',
           'INFO'

    UNION ALL
    SELECT 21,
           'FcrReport: rows (absolute count is drift-prone)',
           (SELECT reports FROM fcr)::text,
           'audit 2026-11-03: 6',
           'INFO'

    UNION ALL
    SELECT 22,
           'FcrReport: identity violations (measured, NOT repaired by design)',
           (SELECT identity_violations FROM fcr)::text,
           'not repaired by design; audit snapshot 0; measured pre-run 2026-11-04: 4',
           'INFO'

    UNION ALL
    SELECT 23,
           'FcrReport: reports with biomassGainKg <= 0 (measured, NOT repaired)',
           (SELECT zero_gain FROM fcr)::text,
           'not repaired by design',
           'INFO'

    UNION ALL
    SELECT 24,
           'FeedEvent: seed-tagged rows (absolute count is drift-prone)',
           (SELECT seed_rows FROM prov)::text,
           'audit 2026-11-03: 112; seed-shaped set total: ' || (SELECT seed_total FROM prov)::text,
           'INFO'

    UNION ALL
    SELECT 25,
           'FeedEvent: import-tagged rows (absolute count is drift-prone)',
           (SELECT import_rows FROM prov)::text,
           'measured pre-run 2026-11-04: 132; post-merge: 66; hand_fed set total: ' || (SELECT import_total FROM prov)::text,
           'INFO'

    UNION ALL
    SELECT 26,
           'FeedEvent: device rows (absolute count is drift-prone)',
           (SELECT device_rows FROM prov)::text,
           'audit 2026-11-03: 312; measured pre-run 2026-11-04: 252',
           'INFO'

    UNION ALL
    SELECT 27,
           'FeedEvent: synthetic rows (left alone; neither seed nor import)',
           (SELECT synthetic_rows FROM prov)::text,
           'measured pre-run 2026-11-04: 16',
           'INFO'

    UNION ALL
    SELECT 28,
           'FeedLevelLog: rows inserted by this run (marker)',
           coalesce((SELECT inserted FROM marker_level), 0)::text,
           'derived: 4 x missing days at run start; measured 2026-11-04: 11 -> 44',
           'INFO'

    UNION ALL
    SELECT 29,
           'FeedLevelLog: missing days at run start (marker)',
           coalesce((SELECT missing_before FROM marker_level), 0)::text,
           'measured 2026-11-04: 11',
           'INFO'
) checks
ORDER BY ord;

-- -----------------------------------------------------------------------------
-- Reported (not asserted): the provenance split after the repair. The measured
-- 2026-11-04 pre-run split was device 252 / import 132 / seed 112 / synthetic
-- 16. After the hand_fed merge, import drops to 66 and the total drops by 66.
-- Synthetic rows are intentionally left alone; they are neither seed nor import.
-- -----------------------------------------------------------------------------
SELECT e."dataSource", count(*) AS row_count
FROM "FeedEvent" e
WHERE e."deviceId" IN (
    SELECT d.id
    FROM "EnergyDevice" d
    JOIN "Pond" p ON p.id = d."pondId"
    WHERE p."ownerId" = 'demo-farmer-1'
      AND p."farmId" = 'farm_demo-farmer-1'
)
GROUP BY 1
ORDER BY 1;

-- -----------------------------------------------------------------------------
-- Evidence: why the six FCR reports were marked stale instead of recomputed.
-- This is the contradiction G2 describes, per report and per window.
-- -----------------------------------------------------------------------------
SELECT r.id,
       r."periodStart",
       r."periodEnd",
       r."totalFeedKg" AS claimed_feed_kg,
       round(coalesce(f.kg, 0)::numeric, 3) AS logged_feed_kg,
       r."biomassGainKg" AS claimed_gain_kg,
       coalesce(b.n, 0) AS biomass_logs_in_window,
       r."fcrValue" AS claimed_fcr,
       CASE
           WHEN r."biomassGainKg" <= 0
           THEN true
           ELSE abs(r."fcrValue" - r."totalFeedKg" / r."biomassGainKg") > 0.000001
       END AS identity_violation,
       (coalesce(f.kg, 0) > 0 AND coalesce(b.n, 0) >= 2) AS computable_from_logs
FROM "FcrReport" r
LEFT JOIN LATERAL (
    SELECT sum(e.grams) / 1000.0 AS kg
    FROM "FeedEvent" e
    WHERE e."deviceId" IN (
        SELECT d.id
        FROM "EnergyDevice" d
        JOIN "Pond" p ON p.id = d."pondId"
        WHERE p."ownerId" = 'demo-farmer-1'
          AND p."farmId" = 'farm_demo-farmer-1'
    )
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
WHERE r."pondId" IN (
    SELECT p.id
    FROM "Pond" p
    WHERE p."ownerId" = 'demo-farmer-1'
      AND p."farmId" = 'farm_demo-farmer-1'
)
ORDER BY r."periodStart";

-- -----------------------------------------------------------------------------
-- Evidence: the modelled level series per farm day for every synthetic row in
-- the demo tenant (this run's inserts plus any earlier batch). A sawtooth (a
-- drop per machine feed, a jump at a refill) is the expected shape; a flat
-- 1.8 %-per-reading line is the old, unreconciled seed. The machine-feed column
-- is the day's dispensed grams, the series the level should follow.
-- -----------------------------------------------------------------------------
WITH synth_day AS (
    SELECT l."deviceId" AS device_id,
           ((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date AS farm_day,
           count(*) AS readings,
           min(l."levelPercent") AS min_pct,
           max(l."levelPercent") AS max_pct,
           min(l."distanceCm") AS min_cm,
           max(l."distanceCm") AS max_cm
    FROM "FeedLevelLog" l
    WHERE l."dataSource" = 'synthetic'
      AND l."deviceId" IN (
          SELECT d.id
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE p."ownerId" = 'demo-farmer-1'
            AND p."farmId" = 'farm_demo-farmer-1'
      )
    GROUP BY 1, 2
)
SELECT s.device_id,
       s.farm_day,
       s.readings,
       round(s.min_pct::numeric, 2) AS min_pct,
       round(s.max_pct::numeric, 2) AS max_pct,
       round(s.min_cm::numeric, 2) AS min_cm,
       round(s.max_cm::numeric, 2) AS max_cm,
       (
           SELECT round(coalesce(sum(e.grams), 0)::numeric, 1)
           FROM "FeedEvent" e
           WHERE e."deviceId" = s.device_id
             AND e."eventType" = 'feed_dispensed'
             AND e.source IN ('scheduled', 'dashboard', 'button')
             AND ((e."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date = s.farm_day
       ) AS machine_feed_g
FROM synth_day s
ORDER BY s.farm_day;
