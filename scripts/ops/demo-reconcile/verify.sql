-- =============================================================================
-- #709 - verification queries for the demo tenant reconciliation
-- =============================================================================
--
-- READ ONLY. Every statement is a SELECT; this file changes nothing.
--
-- Run after scripts/ops/demo-reconcile/reconcile.sql:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/ops/demo-reconcile/verify.sql
--
-- The first result set is the pass/fail table. `PASS` means the observed value
-- equals the expected value; `INFO` is a reported number with no pass/fail
-- (the expected value is the audited count, kept for the reviewer); `FAIL` is
-- a reconciliation that did not hold.
--
-- Tenant scope is the same as reconcile.sql:
--   Pond.ownerId = 'demo-farmer-1' AND Pond.farmId = 'farm_demo-farmer-1'
--   telemetry is reached through the tenant's EnergyDevice rows.
--
-- Expected values are the audited state in #709 (2026-11-03): 132 hand_fed
-- rows over 66 days, 48 missing level days, 3 year-2000 heartbeats, 6 FCR
-- reports. If the sheet is imported again the row counts move; the hard
-- invariants (duplicates = 0, missing days = 0, rtcOk = 0, identity = 0) do not.

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
               WHERE CASE
                   WHEN r."biomassGainKg" > 0
                   THEN abs(r."fcrValue" - r."totalFeedKg" / r."biomassGainKg") > 0.000001
                   ELSE false
               END
           ) AS bad_identity
    FROM "FcrReport" r
    WHERE r."pondId" IN (SELECT id FROM tenant_pond)
),
prov AS (
    SELECT
        count(*) FILTER (WHERE e.source = 'hand_fed' AND e."dataSource" = 'device') AS handfed_device,
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
    SELECT count(*) AS n,
           coalesce(max(jsonb_array_length(x.metadata -> 'levelLogIds')), 0) AS level_ids
    FROM "DeviceStateEvent" x
    WHERE x."eventType" = 'data_imported'
      AND x."farmId" = 'farm_demo-farmer-1'
      AND x.metadata ->> 'issue' = '709'
      AND x.metadata ->> 'kind' = 'demo-history-reconcile'
),
marker_level AS (
    SELECT l.id, l."levelPercent", l."deviceId", l."farmId"
    FROM "FeedLevelLog" l
    WHERE l.id IN (
        SELECT jsonb_array_elements_text(x.metadata -> 'levelLogIds')
        FROM "DeviceStateEvent" x
        WHERE x."eventType" = 'data_imported'
          AND x."farmId" = 'farm_demo-farmer-1'
          AND x.metadata ->> 'issue' = '709'
          AND x.metadata ->> 'kind' = 'demo-history-reconcile'
    )
)
SELECT check_name,
       observed::text AS observed,
       expected::text AS expected,
       status
FROM (
    SELECT 1 AS ord,
           'hand_fed: rows (audit: 132 rows over 66 days merged to 66)' AS check_name,
           (SELECT row_count FROM handfed)::bigint AS observed,
           66::bigint AS expected,
           CASE WHEN (SELECT row_count FROM handfed) = 66 THEN 'PASS' ELSE 'FAIL' END AS status

    UNION ALL
    SELECT 2,
           'hand_fed: rows minus distinct farm days (must be 0)',
           ((SELECT row_count FROM handfed) - (SELECT day_count FROM handfed))::bigint,
           0::bigint,
           CASE
               WHEN (SELECT row_count FROM handfed) = (SELECT day_count FROM handfed) THEN 'PASS'
               ELSE 'FAIL'
           END

    UNION ALL
    SELECT 3,
           'hand_fed: grams preserved (audit: 132 x 46.5 g)',
           (SELECT grams FROM handfed)::bigint,
           6138::bigint,
           'INFO'

    UNION ALL
    SELECT 4,
           'FeedLevelLog: missing farm days in the active demo span (must be 0)',
           (SELECT n FROM missing_level),
           0::bigint,
           CASE WHEN (SELECT n FROM missing_level) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 5,
           'FeedLevelLog: distinct farm days in the active demo span (audit: 77)',
           (SELECT n FROM level_days),
           77::bigint,
           'INFO'

    UNION ALL
    SELECT 6,
           'FeedEvent: year-2000 timestamps with rtcOk = true (must be 0)',
           (SELECT trusted_2000 FROM rtc),
           0::bigint,
           CASE WHEN (SELECT trusted_2000 FROM rtc) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 7,
           'FeedEvent: year-2000 rows preserved (kept as evidence)',
           (SELECT rows_2000 FROM rtc),
           3::bigint,
           'INFO'

    UNION ALL
    SELECT 8,
           'FcrReport: rows (audit: 6, left unchanged)',
           (SELECT reports FROM fcr),
           6::bigint,
           'INFO'

    UNION ALL
    SELECT 9,
           'FcrReport: fcrValue <> totalFeedKg / biomassGainKg (must be 0)',
           (SELECT bad_identity FROM fcr),
           0::bigint,
           CASE WHEN (SELECT bad_identity FROM fcr) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 10,
           'FcrReport: reports with biomassGainKg <= 0 (must be 0)',
           (SELECT zero_gain FROM fcr),
           0::bigint,
           CASE WHEN (SELECT zero_gain FROM fcr) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 11,
           'FeedEvent: hand_fed rows still marked dataSource = device (must be 0)',
           (SELECT handfed_device FROM prov),
           0::bigint,
           CASE WHEN (SELECT handfed_device FROM prov) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 12,
           'FeedEvent: seed-shaped rows still marked dataSource = device (must be 0)',
           (SELECT seed_device FROM prov),
           0::bigint,
           CASE WHEN (SELECT seed_device FROM prov) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 13,
           'demo-pond-001: status ACTIVE (must be 0)',
           (SELECT active FROM g9),
           0::bigint,
           CASE WHEN (SELECT active FROM g9) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 14,
           'demo-pond-001: retired rows (name + ARCHIVED + fallow)',
           (SELECT retired FROM g9),
           (SELECT present FROM g9),
           CASE WHEN (SELECT retired FROM g9) = (SELECT present FROM g9) THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 15,
           'demo-pond-001: pending or sent ScheduleCommand rows (must be 0)',
           (SELECT pending FROM g9),
           0::bigint,
           CASE WHEN (SELECT pending FROM g9) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 16,
           'demo-pond-001: devices whose gramsPerFeeding <> 1500 (must be 0)',
           (SELECT dose_mismatch FROM g9),
           0::bigint,
           CASE WHEN (SELECT dose_mismatch FROM g9) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 17,
           'farm stamp: demo rows with a null or wrong farmId (must be 0)',
           (SELECT bad FROM stamps),
           0::bigint,
           CASE WHEN (SELECT bad FROM stamps) = 0 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 18,
           'audit marker: DeviceStateEvent issue 709 rows (must be 1)',
           (SELECT n FROM marker),
           1::bigint,
           CASE WHEN (SELECT n FROM marker) = 1 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 19,
           'level rows inserted by this reconciliation (0 if already covered)',
           (SELECT count(*) FROM marker_level),
           (SELECT level_ids FROM marker),
           'INFO'

    UNION ALL
    SELECT 20,
           'inserted level rows outside 0..100 % or the tenant (must be 0)',
           (SELECT count(*) FROM marker_level
             WHERE "levelPercent" < 0
                OR "levelPercent" > 100
                OR "farmId" IS DISTINCT FROM 'farm_demo-farmer-1'
                OR "deviceId" NOT IN (SELECT id FROM tenant_device)),
           0::bigint,
           CASE
               WHEN (SELECT count(*) FROM marker_level
                      WHERE "levelPercent" < 0
                         OR "levelPercent" > 100
                         OR "farmId" IS DISTINCT FROM 'farm_demo-farmer-1'
                         OR "deviceId" NOT IN (SELECT id FROM tenant_device)) = 0 THEN 'PASS'
               ELSE 'FAIL'
           END

    UNION ALL
    SELECT 21,
           'FeedEvent: seed rows tagged (audit: 112)',
           (SELECT seed_rows FROM prov),
           112::bigint,
           CASE WHEN (SELECT seed_rows FROM prov) = 112 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 22,
           'FeedEvent: import rows tagged (audit: 66 after the merge)',
           (SELECT import_rows FROM prov),
           66::bigint,
           CASE WHEN (SELECT import_rows FROM prov) = 66 THEN 'PASS' ELSE 'FAIL' END

    UNION ALL
    SELECT 23,
           'FeedEvent: device rows remaining (audit: 312 real)',
           (SELECT device_rows FROM prov),
           312::bigint,
           'INFO'
) checks
ORDER BY ord;

-- -----------------------------------------------------------------------------
-- Reported (not asserted): the provenance split after the repair. The expected
-- audited split is device 312 / import 66 / seed 112, plus 0 or 16 synthetic
-- rows if the earlier W5 fill is present. `device` must never contain hand_fed
-- or seed-shaped rows; those are asserted above.
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
-- Evidence: the modelled level series per farm day for the rows this run
-- inserted. A sawtooth (a drop per machine feed, a jump at a refill) is the
-- expected shape; a flat 1.8 %-per-reading line is the old, unreconciled seed.
-- -----------------------------------------------------------------------------
SELECT ((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date AS farm_day,
       count(*) AS readings,
       round(min(l."levelPercent")::numeric, 2) AS min_pct,
       round(max(l."levelPercent")::numeric, 2) AS max_pct,
       round(min(l."distanceCm")::numeric, 2) AS min_cm,
       round(max(l."distanceCm")::numeric, 2) AS max_cm
FROM "FeedLevelLog" l
WHERE l.id IN (
    SELECT jsonb_array_elements_text(x.metadata -> 'levelLogIds')
    FROM "DeviceStateEvent" x
    WHERE x."eventType" = 'data_imported'
      AND x."farmId" = 'farm_demo-farmer-1'
      AND x.metadata ->> 'issue' = '709'
      AND x.metadata ->> 'kind' = 'demo-history-reconcile'
)
GROUP BY 1
ORDER BY 1;
