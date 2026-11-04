-- #711 Phase 2: policies for the remaining tenant tables.
--
-- Additive policy work. No DELETE, TRUNCATE, DROP TABLE, column change or data
-- backfill. `Membership` and `Organization` are replaced only to switch the
-- single `app.org_id` to the multi-org `app.org_ids` list.
--
-- Platform-only tables are deliberately left default-deny for optifeed_app:
--   AiProviderConfig, PlatformAdmin, PlatformAuditLog, ImpersonationSession,
--   PlatformIncident, PlatformIncidentEvent, PlatformSetting, ErrorEvent,
--   IssueReport, CronHeartbeat.
-- Platform-admin paths must keep using the privileged connection until a
-- separate platform context is designed.

ALTER TABLE "BiomassLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FcrReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FishSample" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalibrationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScheduleCommand" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PondSettingsDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PondEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MortalityLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CropCycle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReminderLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeviceConnectivityDaily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportConfirmation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssistantAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BackgroundJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobArtifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PondOwnershipHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Device" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedingEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgSetting" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Replace the single-org policies from Phase 1 with the multi-org list.
  DROP POLICY IF EXISTS tenant_app_membership ON "Membership";
  CREATE POLICY tenant_app_membership ON "Membership"
    FOR ALL TO optifeed_app
    USING (
      "orgId" = ANY (string_to_array(current_setting('app.org_ids', true), ','))
      OR "userId" = current_setting('app.user_id', true)
    )
    WITH CHECK (
      "orgId" = ANY (string_to_array(current_setting('app.org_ids', true), ','))
      OR "userId" = current_setting('app.user_id', true)
    );

  DROP POLICY IF EXISTS tenant_app_organization ON "Organization";
  CREATE POLICY tenant_app_organization ON "Organization"
    FOR ALL TO optifeed_app
    USING (id = ANY (string_to_array(current_setting('app.org_ids', true), ',')))
    WITH CHECK (id = ANY (string_to_array(current_setting('app.org_ids', true), ',')));

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'BiomassLog' AND policyname = 'tenant_app_biomass'
  ) THEN
    CREATE POLICY tenant_app_biomass ON "BiomassLog"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "BiomassLog"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "BiomassLog"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'FcrReport' AND policyname = 'tenant_app_fcr'
  ) THEN
    CREATE POLICY tenant_app_fcr ON "FcrReport"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "FcrReport"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "FcrReport"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'FishSample' AND policyname = 'tenant_app_fish_sample'
  ) THEN
    CREATE POLICY tenant_app_fish_sample ON "FishSample"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1
          FROM "BiomassLog" b
          JOIN "Pond" p ON p.id = b."pondId"
          WHERE b.id = "FishSample"."biomassLogId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM "BiomassLog" b
          JOIN "Pond" p ON p.id = b."pondId"
          WHERE b.id = "FishSample"."biomassLogId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'CalibrationRun' AND policyname = 'tenant_app_calibration'
  ) THEN
    CREATE POLICY tenant_app_calibration ON "CalibrationRun"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "CalibrationRun"."deviceId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "CalibrationRun"."deviceId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ScheduleCommand' AND policyname = 'tenant_app_schedule_command'
  ) THEN
    CREATE POLICY tenant_app_schedule_command ON "ScheduleCommand"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "ScheduleCommand"."deviceId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "ScheduleCommand"."deviceId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'PondSettingsDraft' AND policyname = 'tenant_app_pond_draft'
  ) THEN
    CREATE POLICY tenant_app_pond_draft ON "PondSettingsDraft"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "PondSettingsDraft"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "PondSettingsDraft"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'PondEvent' AND policyname = 'tenant_app_pond_event'
  ) THEN
    CREATE POLICY tenant_app_pond_event ON "PondEvent"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "PondEvent"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "PondEvent"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'MortalityLog' AND policyname = 'tenant_app_mortality'
  ) THEN
    CREATE POLICY tenant_app_mortality ON "MortalityLog"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "MortalityLog"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "MortalityLog"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'CropCycle' AND policyname = 'tenant_app_crop_cycle'
  ) THEN
    CREATE POLICY tenant_app_crop_cycle ON "CropCycle"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "CropCycle"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "CropCycle"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ReminderLog' AND policyname = 'tenant_app_reminder'
  ) THEN
    CREATE POLICY tenant_app_reminder ON "ReminderLog"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "ReminderLog"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "ReminderLog"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'DeviceConnectivityDaily' AND policyname = 'tenant_app_connectivity'
  ) THEN
    CREATE POLICY tenant_app_connectivity ON "DeviceConnectivityDaily"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "DeviceConnectivityDaily"."deviceId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM "EnergyDevice" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "DeviceConnectivityDaily"."deviceId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ImportConfirmation' AND policyname = 'tenant_app_import_confirmation'
  ) THEN
    CREATE POLICY tenant_app_import_confirmation ON "ImportConfirmation"
      FOR ALL TO optifeed_app
      USING ("ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ',')))
      WITH CHECK ("ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ',')));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'AssistantAction' AND policyname = 'tenant_app_assistant_action'
  ) THEN
    CREATE POLICY tenant_app_assistant_action ON "AssistantAction"
      FOR ALL TO optifeed_app
      USING (
        "userId" = current_setting('app.user_id', true)
        OR "orgId" = ANY (string_to_array(current_setting('app.org_ids', true), ','))
        OR "pondId" = ANY (string_to_array(current_setting('app.pond_ids', true), ','))
      )
      WITH CHECK (
        "userId" = current_setting('app.user_id', true)
        OR "orgId" = ANY (string_to_array(current_setting('app.org_ids', true), ','))
        OR "pondId" = ANY (string_to_array(current_setting('app.pond_ids', true), ','))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'BackgroundJob' AND policyname = 'tenant_app_background_job'
  ) THEN
    CREATE POLICY tenant_app_background_job ON "BackgroundJob"
      FOR ALL TO optifeed_app
      USING ("ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ',')))
      WITH CHECK ("ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ',')));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'JobArtifact' AND policyname = 'tenant_app_job_artifact'
  ) THEN
    CREATE POLICY tenant_app_job_artifact ON "JobArtifact"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1 FROM "BackgroundJob" j
          WHERE j.id = "JobArtifact"."jobId"
            AND j."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM "BackgroundJob" j
          WHERE j.id = "JobArtifact"."jobId"
            AND j."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'PondOwnershipHistory' AND policyname = 'tenant_app_pond_history'
  ) THEN
    CREATE POLICY tenant_app_pond_history ON "PondOwnershipHistory"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "PondOwnershipHistory"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "PondOwnershipHistory"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'Device' AND policyname = 'tenant_app_legacy_device'
  ) THEN
    CREATE POLICY tenant_app_legacy_device ON "Device"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "Device"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "Device"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'FeedingEvent' AND policyname = 'tenant_app_feeding_event'
  ) THEN
    CREATE POLICY tenant_app_feeding_event ON "FeedingEvent"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1
          FROM "Device" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "FeedingEvent"."deviceId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM "Device" d
          JOIN "Pond" p ON p.id = d."pondId"
          WHERE d.id = "FeedingEvent"."deviceId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'OrgSetting' AND policyname = 'tenant_app_org_setting'
  ) THEN
    CREATE POLICY tenant_app_org_setting ON "OrgSetting"
      FOR ALL TO optifeed_app
      USING ("orgId" = ANY (string_to_array(current_setting('app.org_ids', true), ',')))
      WITH CHECK ("orgId" = ANY (string_to_array(current_setting('app.org_ids', true), ',')));
  END IF;
END
$$;
