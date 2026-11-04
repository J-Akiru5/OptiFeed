-- =============================================================================
-- #709 - read-only dry run for the demo tenant reconciliation
-- =============================================================================
--
-- READ ONLY. Every statement is a SELECT; this file creates no temp table and
-- writes no row. Run it BEFORE reconcile.sql so an operator can see the derived
-- expectations the guards will use:
--
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/ops/demo-reconcile/dry-run.sql
--
-- Output is one table: section, metric, value. It prints the measured state and
-- the derived expectation for each mutation. Nothing here asserts; if a number
-- looks wrong, stop before running reconcile.sql.
--
-- Tenant scope:
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
handfed_day AS (
    SELECT e."deviceId" AS device_id,
           ((e."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date AS farm_day,
           count(*) AS n,
           sum(coalesce(e.grams, 0))::numeric AS total_g
    FROM "FeedEvent" e
    WHERE e.source = 'hand_fed'
      AND e."deviceId" IN (SELECT id FROM tenant_device)
    GROUP BY 1, 2
),
handfed_survivor AS (
    SELECT d.device_id,
           d.farm_day,
           d.n,
           d.total_g,
           (
               SELECT e.grams
               FROM "FeedEvent" e
               WHERE e.source = 'hand_fed'
                 AND e."deviceId" = d.device_id
                 AND ((e."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date = d.farm_day
               ORDER BY e."receivedAt" ASC, e.id ASC
               LIMIT 1
           ) AS survivor_grams
    FROM handfed_day d
    WHERE d.n > 1
),
level_active AS (
    SELECT d.id
    FROM tenant_device d
    WHERE d.pond_status = 'ACTIVE'
),
level_span AS (
    SELECT l."deviceId" AS device_id,
           min((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date AS lo,
           max((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date AS hi
    FROM "FeedLevelLog" l
    WHERE l."deviceId" IN (SELECT id FROM level_active)
    GROUP BY 1
),
level_missing AS (
    SELECT s.device_id,
           g::date AS farm_day
    FROM level_span s
    CROSS JOIN LATERAL generate_series(s.lo::timestamp, s.hi::timestamp, interval '1 day') g
    WHERE NOT EXISTS (
        SELECT 1
        FROM "FeedLevelLog" l
        WHERE l."deviceId" = s.device_id
          AND ((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date = g::date
    )
),
rtc AS (
    SELECT count(*) FILTER (WHERE e."timestamp" LIKE '2000-01-01%') AS rows_2000,
           count(*) FILTER (
               WHERE e."timestamp" LIKE '2000-01-01%' AND e."rtcOk" IS TRUE
           ) AS trusted_2000,
           count(*) FILTER (
               WHERE e."eventType" = 'heartbeat'
                 AND e."timestamp" LIKE '2000-01-01%'
                 AND e."rtcOk" IS DISTINCT FROM false
           ) AS matched
    FROM "FeedEvent" e
    WHERE e."deviceId" IN (SELECT id FROM tenant_device)
),
seed_set AS (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE e."dataSource" = 'seed') AS tagged,
           count(*) FILTER (WHERE e."dataSource" = 'device') AS untagged,
           count(*) FILTER (WHERE e."dataSource" = 'synthetic') AS synthetic
    FROM "FeedEvent" e
    WHERE e."deviceId" IN (SELECT id FROM tenant_device)
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
      )
),
import_set AS (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE e."dataSource" = 'import') AS tagged,
           count(*) FILTER (WHERE e."dataSource" = 'device') AS untagged,
           count(*) FILTER (WHERE e."dataSource" = 'synthetic') AS synthetic
    FROM "FeedEvent" e
    WHERE e.source = 'hand_fed'
      AND e."deviceId" IN (SELECT id FROM tenant_device)
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
fcr AS (
    SELECT count(*) AS reports,
           count(*) FILTER (
               WHERE r."biomassGainKg" <= 0
                  OR CASE
                         WHEN r."biomassGainKg" > 0
                         THEN abs(r."fcrValue" - r."totalFeedKg" / r."biomassGainKg") > 0.000001
                         ELSE false
                     END
           ) AS identity_violations,
           count(*) FILTER (WHERE r."biomassGainKg" <= 0) AS zero_gain
    FROM "FcrReport" r
    WHERE r."pondId" IN (SELECT id FROM tenant_pond)
),
marker AS (
    SELECT count(*) AS n
    FROM "DeviceStateEvent" x
    WHERE x."eventType" = 'data_imported'
      AND x."farmId" = 'farm_demo-farmer-1'
      AND x.metadata ->> 'issue' = '709'
      AND x.metadata ->> 'kind' = 'demo-history-reconcile'
),
totals AS (
    SELECT
        (SELECT count(*) FROM "FeedEvent" WHERE "deviceId" IN (SELECT id FROM tenant_device)) AS feed_events,
        (SELECT count(*) FROM "FeedLevelLog" WHERE "deviceId" IN (SELECT id FROM tenant_device)) AS level_rows,
        (SELECT count(*) FROM "FeedEvent" WHERE "deviceId" IN (SELECT id FROM tenant_device)
          AND "dataSource" = 'synthetic') AS synthetic_rows
)
SELECT section, metric, value
FROM (
    VALUES
        -- Scope
        ('tenant', 'ponds', (SELECT count(*) FROM tenant_pond)::text),
        ('tenant', 'devices', (SELECT count(*) FROM tenant_device)::text),
        ('tenant', 'active_devices', (SELECT count(*) FROM tenant_device WHERE pond_status = 'ACTIVE')::text),
        ('tenant', 'feed_events_total', (SELECT feed_events FROM totals)::text),
        ('tenant', 'feed_level_rows_total', (SELECT level_rows FROM totals)::text),

        -- hand_fed and the merge
        ('hand_fed', 'rows', (SELECT row_count FROM handfed)::text),
        ('hand_fed', 'distinct_farm_days', (SELECT day_count FROM handfed)::text),
        ('hand_fed', 'duplicate_rows', ((SELECT row_count FROM handfed) - (SELECT day_count FROM handfed))::text),
        ('hand_fed', 'multi_row_days', (SELECT count(*) FROM handfed_survivor)::text),
        ('hand_fed', 'survivor_updates', (
            SELECT count(*) FROM handfed_survivor
            WHERE survivor_grams IS DISTINCT FROM total_g
        )::text),
        ('hand_fed', 'delete_rows', (SELECT coalesce(sum(n - 1), 0) FROM handfed_survivor)::text),
        ('hand_fed', 'grams_before', (SELECT grams FROM handfed)::text),
        ('hand_fed', 'rows_after_merge', (SELECT day_count FROM handfed)::text),

        -- FeedLevelLog gaps and planned inserts
        ('level', 'active_span_days', (SELECT coalesce(sum(hi - lo + 1), 0) FROM level_span)::text),
        ('level', 'present_days', (
            SELECT count(DISTINCT ((l."recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::date)
            FROM "FeedLevelLog" l
            WHERE l."deviceId" IN (SELECT id FROM level_active)
        )::text),
        ('level', 'missing_days', (SELECT count(*) FROM level_missing)::text),
        ('level', 'planned_insert_rows', (4 * (SELECT count(*) FROM level_missing))::text),

        -- RTC repair
        ('rtc', 'year_2000_rows', (SELECT rows_2000 FROM rtc)::text),
        ('rtc', 'trusted_year_2000', (SELECT trusted_2000 FROM rtc)::text),
        ('rtc', 'matched_for_repair', (SELECT matched FROM rtc)::text),
        ('rtc', 'repaired_expected', (SELECT matched FROM rtc)::text),
        ('rtc', 'trusted_after_expected', '0'::text),

        -- Provenance
        ('seed', 'seed_shaped_total', (SELECT total FROM seed_set)::text),
        ('seed', 'already_seed', (SELECT tagged FROM seed_set)::text),
        ('seed', 'untagged_device', (SELECT untagged FROM seed_set)::text),
        ('seed', 'synthetic_matching_seed_shape', (SELECT synthetic FROM seed_set)::text),
        ('import', 'hand_fed_total_current', (SELECT total FROM import_set)::text),
        ('import', 'already_import', (SELECT tagged FROM import_set)::text),
        ('import', 'untagged_device', (SELECT untagged FROM import_set)::text),
        ('import', 'synthetic_hand_fed', (SELECT synthetic FROM import_set)::text),
        ('import', 'import_total_after_merge', (SELECT day_count FROM handfed)::text),
        ('synthetic', 'synthetic_feed_events_total', (SELECT synthetic_rows FROM totals)::text),

        -- G9 demo-pond-001
        ('g9', 'pond_present', (SELECT present FROM g9)::text),
        ('g9', 'active', (SELECT active FROM g9)::text),
        ('g9', 'retired', (SELECT retired FROM g9)::text),
        ('g9', 'pending_commands', (SELECT pending FROM g9)::text),
        ('g9', 'dose_mismatch', (SELECT dose_mismatch FROM g9)::text),

        -- FCR (deliberately not repaired)
        ('fcr', 'reports', (SELECT reports FROM fcr)::text),
        ('fcr', 'identity_violations', (SELECT identity_violations FROM fcr)::text),
        ('fcr', 'zero_gain', (SELECT zero_gain FROM fcr)::text),

        -- Existing audit marker
        ('marker', 'existing_rows', (SELECT n FROM marker)::text),
        ('marker', 'expected_rows_after_run', '1'::text)
) AS m(section, metric, value)
ORDER BY section, metric;
