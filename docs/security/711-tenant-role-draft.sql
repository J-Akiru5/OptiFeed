-- #711 draft: dedicated tenant role and core RLS policies.
--
-- REVIEW ARTIFACT, NOT A PRISMA MIGRATION.
--
-- This file contains no DROP, DELETE, TRUNCATE, UPDATE or data backfill. It
-- only creates an app role, grants privileges, enables RLS (idempotent) and
-- creates policies that apply only to optifeed_app. The current app keeps
-- using the privileged connection, so this is inert until DATABASE_URL is
-- switched during the planned window.
--
-- Do not move this file into apps/web/prisma/migrations until:
--   1. every table is classified as tenant-scoped or global,
--   2. every tenant table has a policy,
--   3. the app-side withTenant helper sets app.farm_id / app.user_id /
--      app.supabase_id / app.org_id inside the transaction,
--   4. the two-tenant proof passes on a staging copy.

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

-- RLS is already enabled on the 19 tables from migration
-- 20261103100000_db_rls_index_retention. These statements are idempotent and
-- only matter if a table is recreated.
ALTER TABLE "Farm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Pond" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaterTempLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedLevelLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeviceStateEvent" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Farm' AND policyname = 'tenant_app_farm'
  ) THEN
    CREATE POLICY tenant_app_farm ON "Farm"
      FOR ALL TO optifeed_app
      USING (
        id = current_setting('app.farm_id', true)
        OR "ownerId" = current_setting('app.farm_id', true)
      )
      WITH CHECK (
        id = current_setting('app.farm_id', true)
        OR "ownerId" = current_setting('app.farm_id', true)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Pond' AND policyname = 'tenant_app_pond'
  ) THEN
    CREATE POLICY tenant_app_pond ON "Pond"
      FOR ALL TO optifeed_app
      USING ("farmId" = current_setting('app.farm_id', true))
      WITH CHECK ("farmId" = current_setting('app.farm_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'User' AND policyname = 'tenant_app_user'
  ) THEN
    CREATE POLICY tenant_app_user ON "User"
      FOR ALL TO optifeed_app
      USING (
        "farmId" = current_setting('app.farm_id', true)
        OR "supabaseId" = current_setting('app.supabase_id', true)
      )
      WITH CHECK (
        "farmId" = current_setting('app.farm_id', true)
        OR "supabaseId" = current_setting('app.supabase_id', true)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Membership' AND policyname = 'tenant_app_membership'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Organization' AND policyname = 'tenant_app_organization'
  ) THEN
    CREATE POLICY tenant_app_organization ON "Organization"
      FOR ALL TO optifeed_app
      USING (id = current_setting('app.org_id', true))
      WITH CHECK (id = current_setting('app.org_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'FeedEvent' AND policyname = 'tenant_app_feed_event'
  ) THEN
    CREATE POLICY tenant_app_feed_event ON "FeedEvent"
      FOR ALL TO optifeed_app
      USING (
        "farmId" = current_setting('app.farm_id', true)
        OR EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "FeedEvent"."deviceId"
            AND p."farmId" = current_setting('app.farm_id', true)
        )
      )
      WITH CHECK (
        "farmId" = current_setting('app.farm_id', true)
        OR EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "FeedEvent"."deviceId"
            AND p."farmId" = current_setting('app.farm_id', true)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Notification' AND policyname = 'tenant_app_notification'
  ) THEN
    CREATE POLICY tenant_app_notification ON "Notification"
      FOR ALL TO optifeed_app
      USING (
        "farmId" = current_setting('app.farm_id', true)
        OR EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "Notification"."pondId"
            AND p."farmId" = current_setting('app.farm_id', true)
        )
      )
      WITH CHECK (
        "farmId" = current_setting('app.farm_id', true)
        OR EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "Notification"."pondId"
            AND p."farmId" = current_setting('app.farm_id', true)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'FeedRequest' AND policyname = 'tenant_app_feed_request'
  ) THEN
    CREATE POLICY tenant_app_feed_request ON "FeedRequest"
      FOR ALL TO optifeed_app
      USING (
        "farmId" = current_setting('app.farm_id', true)
        OR EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "FeedRequest"."deviceId"
            AND p."farmId" = current_setting('app.farm_id', true)
        )
      )
      WITH CHECK (
        "farmId" = current_setting('app.farm_id', true)
        OR EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "FeedRequest"."deviceId"
            AND p."farmId" = current_setting('app.farm_id', true)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'WaterTempLog' AND policyname = 'tenant_app_water_temp'
  ) THEN
    CREATE POLICY tenant_app_water_temp ON "WaterTempLog"
      FOR ALL TO optifeed_app
      USING (
        "farmId" = current_setting('app.farm_id', true)
        OR EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "WaterTempLog"."deviceId"
            AND p."farmId" = current_setting('app.farm_id', true)
        )
      )
      WITH CHECK (
        "farmId" = current_setting('app.farm_id', true)
        OR EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "WaterTempLog"."deviceId"
            AND p."farmId" = current_setting('app.farm_id', true)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'FeedLevelLog' AND policyname = 'tenant_app_feed_level'
  ) THEN
    CREATE POLICY tenant_app_feed_level ON "FeedLevelLog"
      FOR ALL TO optifeed_app
      USING (
        "farmId" = current_setting('app.farm_id', true)
        OR EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "FeedLevelLog"."deviceId"
            AND p."farmId" = current_setting('app.farm_id', true)
        )
      )
      WITH CHECK (
        "farmId" = current_setting('app.farm_id', true)
        OR EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "FeedLevelLog"."deviceId"
            AND p."farmId" = current_setting('app.farm_id', true)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'DeviceStateEvent' AND policyname = 'tenant_app_device_state'
  ) THEN
    CREATE POLICY tenant_app_device_state ON "DeviceStateEvent"
      FOR ALL TO optifeed_app
      USING (
        "farmId" = current_setting('app.farm_id', true)
        OR EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "DeviceStateEvent"."deviceId"
            AND p."farmId" = current_setting('app.farm_id', true)
        )
      )
      WITH CHECK (
        "farmId" = current_setting('app.farm_id', true)
        OR EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "DeviceStateEvent"."deviceId"
            AND p."farmId" = current_setting('app.farm_id', true)
        )
      );
  END IF;
END
$$;
