-- #711 Phase 1: dedicated tenant role, grants and core RLS policies.
--
-- SAFE TO APPLY BEFORE THE APP SWITCH:
--   * the current app keeps using the privileged `postgres` connection;
--   * every policy below applies ONLY to `optifeed_app`;
--   * this migration contains no INSERT/UPDATE/DELETE/TRUNCATE, no column
--     change and no data backfill.
--
-- The app still bypasses RLS until Phase 2 sets the tenant context and
-- DATABASE_URL is switched during the documented maintenance window.
--
-- Tenant context set by the app per transaction (Phase 2):
--   SET LOCAL app.farm_ids     = 'farm-a,farm-b';  -- User.farmId login slugs
--   SET LOCAL app.pond_ids     = 'pond-1,pond-2';  -- allowed Pond ids
--   SET LOCAL app.user_id      = '<User.id>';
--   SET LOCAL app.supabase_id  = '<Supabase Auth user id>';
--   SET LOCAL app.org_id       = '<Organization.id>';
--
-- An unset setting makes the ANY(...) comparison NULL/false, so the new role
-- sees no rows by default. That is intentional fail-closed behaviour.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'optifeed_app') THEN
    CREATE ROLE optifeed_app
      LOGIN
      NOBYPASSRLS
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO optifeed_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO optifeed_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO optifeed_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO optifeed_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO optifeed_app;

-- Already enabled by 20261103100000_db_rls_index_retention and the later
-- table migrations; these statements are idempotent and protect a recreated
-- table.
ALTER TABLE "Farm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Pond" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EnergyDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaterTempLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedLevelLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeviceStateEvent" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'Farm' AND policyname = 'tenant_app_farm'
  ) THEN
    CREATE POLICY tenant_app_farm ON "Farm"
      FOR ALL TO optifeed_app
      USING (
        "ownerId" = ANY (
          string_to_array(current_setting('app.farm_ids', true), ',')
        )
      )
      WITH CHECK (
        "ownerId" = ANY (
          string_to_array(current_setting('app.farm_ids', true), ',')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'Pond' AND policyname = 'tenant_app_pond'
  ) THEN
    CREATE POLICY tenant_app_pond ON "Pond"
      FOR ALL TO optifeed_app
      USING (
        "ownerId" = ANY (
          string_to_array(current_setting('app.farm_ids', true), ',')
        )
        OR id = ANY (
          string_to_array(current_setting('app.pond_ids', true), ',')
        )
      )
      WITH CHECK (
        "ownerId" = ANY (
          string_to_array(current_setting('app.farm_ids', true), ',')
        )
        OR id = ANY (
          string_to_array(current_setting('app.pond_ids', true), ',')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'User' AND policyname = 'tenant_app_user'
  ) THEN
    CREATE POLICY tenant_app_user ON "User"
      FOR ALL TO optifeed_app
      USING (
        "farmId" = ANY (
          string_to_array(current_setting('app.farm_ids', true), ',')
        )
        OR "supabaseId" = current_setting('app.supabase_id', true)
      )
      WITH CHECK (
        "farmId" = ANY (
          string_to_array(current_setting('app.farm_ids', true), ',')
        )
        OR "supabaseId" = current_setting('app.supabase_id', true)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'Membership' AND policyname = 'tenant_app_membership'
  ) THEN
    CREATE POLICY tenant_app_membership ON "Membership"
      FOR ALL TO optifeed_app
      USING (
        "orgId" = current_setting('app.org_id', true)
        OR "userId" = current_setting('app.user_id', true)
      )
      WITH CHECK (
        "orgId" = current_setting('app.org_id', true)
        OR "userId" = current_setting('app.user_id', true)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'Organization' AND policyname = 'tenant_app_organization'
  ) THEN
    CREATE POLICY tenant_app_organization ON "Organization"
      FOR ALL TO optifeed_app
      USING (id = current_setting('app.org_id', true))
      WITH CHECK (id = current_setting('app.org_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'EnergyDevice' AND policyname = 'tenant_app_energy_device'
  ) THEN
    CREATE POLICY tenant_app_energy_device ON "EnergyDevice"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "EnergyDevice"."pondId"
            AND p."ownerId" = ANY (
              string_to_array(current_setting('app.farm_ids', true), ',')
            )
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "EnergyDevice"."pondId"
            AND p."ownerId" = ANY (
              string_to_array(current_setting('app.farm_ids', true), ',')
            )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'FeedEvent' AND policyname = 'tenant_app_feed_event'
  ) THEN
    CREATE POLICY tenant_app_feed_event ON "FeedEvent"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "FeedEvent"."deviceId"
            AND p."ownerId" = ANY (
              string_to_array(current_setting('app.farm_ids', true), ',')
            )
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "FeedEvent"."deviceId"
            AND p."ownerId" = ANY (
              string_to_array(current_setting('app.farm_ids', true), ',')
            )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'Notification' AND policyname = 'tenant_app_notification'
  ) THEN
    CREATE POLICY tenant_app_notification ON "Notification"
      FOR ALL TO optifeed_app
      USING (
        "pondId" = ANY (
          string_to_array(current_setting('app.pond_ids', true), ',')
        )
        OR EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "Notification"."pondId"
            AND p."ownerId" = ANY (
              string_to_array(current_setting('app.farm_ids', true), ',')
            )
        )
      )
      WITH CHECK (
        "pondId" = ANY (
          string_to_array(current_setting('app.pond_ids', true), ',')
        )
        OR EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "Notification"."pondId"
            AND p."ownerId" = ANY (
              string_to_array(current_setting('app.farm_ids', true), ',')
            )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'FeedRequest' AND policyname = 'tenant_app_feed_request'
  ) THEN
    CREATE POLICY tenant_app_feed_request ON "FeedRequest"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "FeedRequest"."deviceId"
            AND p."ownerId" = ANY (
              string_to_array(current_setting('app.farm_ids', true), ',')
            )
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "FeedRequest"."deviceId"
            AND p."ownerId" = ANY (
              string_to_array(current_setting('app.farm_ids', true), ',')
            )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'WaterTempLog' AND policyname = 'tenant_app_water_temp'
  ) THEN
    CREATE POLICY tenant_app_water_temp ON "WaterTempLog"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "WaterTempLog"."deviceId"
            AND p."ownerId" = ANY (
              string_to_array(current_setting('app.farm_ids', true), ',')
            )
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "WaterTempLog"."deviceId"
            AND p."ownerId" = ANY (
              string_to_array(current_setting('app.farm_ids', true), ',')
            )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'FeedLevelLog' AND policyname = 'tenant_app_feed_level'
  ) THEN
    CREATE POLICY tenant_app_feed_level ON "FeedLevelLog"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "FeedLevelLog"."deviceId"
            AND p."ownerId" = ANY (
              string_to_array(current_setting('app.farm_ids', true), ',')
            )
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "FeedLevelLog"."deviceId"
            AND p."ownerId" = ANY (
              string_to_array(current_setting('app.farm_ids', true), ',')
            )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'DeviceStateEvent' AND policyname = 'tenant_app_device_state'
  ) THEN
    CREATE POLICY tenant_app_device_state ON "DeviceStateEvent"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "DeviceStateEvent"."deviceId"
            AND p."ownerId" = ANY (
              string_to_array(current_setting('app.farm_ids', true), ',')
            )
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "DeviceStateEvent"."deviceId"
            AND p."ownerId" = ANY (
              string_to_array(current_setting('app.farm_ids', true), ',')
            )
        )
      );
  END IF;
END
$$;
