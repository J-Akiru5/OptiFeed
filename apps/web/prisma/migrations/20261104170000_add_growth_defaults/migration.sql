-- #826 part 2 / #828: per-farm growth defaults and per-pond overrides.
--
-- ADDITIVE AND NULLABLE ONLY. No existing column is dropped, rewritten or
-- backfilled. A null column (or a missing PondGrowthOverride row) means "not
-- set" and resolves to the documented constant in lib/growth/defaults.ts, so
-- existing cycles and existing organizations keep their current behaviour.
--
-- Prefix ledger: latest applied prefix on origin/develop at the time of writing
-- is 20261104160000 (tenant_app_role_phase2); 20261104170000 is not used by any
-- other branch or open PR.

-- Farm defaults live on the organization settings row. Nullable so an owner can
-- clear a value instead of freezing today's number.
ALTER TABLE "OrgSetting"
  ADD COLUMN "defaultGrowOutDays" INTEGER,
  ADD COLUMN "defaultTargetHarvestWeightG" DOUBLE PRECISION,
  ADD COLUMN "defaultExpectedSurvivalPct" DOUBLE PRECISION,
  ADD COLUMN "defaultStockingAvgWeightG" DOUBLE PRECISION,
  ADD COLUMN "densityAdvisoryPerM2" DOUBLE PRECISION;

-- Per-pond override. One row per pond; every column is nullable and inherited
-- individually, so setting survival does not mask a later farm change to the
-- target weight.
CREATE TABLE "PondGrowthOverride" (
    "pondId" TEXT NOT NULL,
    "growOutDays" INTEGER,
    "targetHarvestWeightG" DOUBLE PRECISION,
    "expectedSurvivalPct" DOUBLE PRECISION,
    "stockingAvgWeightG" DOUBLE PRECISION,
    "densityAdvisoryPerM2" DOUBLE PRECISION,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PondGrowthOverride_pkey" PRIMARY KEY ("pondId")
);

ALTER TABLE "PondGrowthOverride"
  ADD CONSTRAINT "PondGrowthOverride_pondId_fkey"
  FOREIGN KEY ("pondId") REFERENCES "Pond"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant containment, matching the #711 phase 2 pattern: a row is visible to
-- optifeed_app only through a pond the caller's farm ids own. The application
-- connects as a BYPASSRLS role, so this constrains the Supabase surface and is
-- not the app's isolation boundary (that remains resolveOrgScope()).
ALTER TABLE "PondGrowthOverride" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'PondGrowthOverride'
      AND policyname = 'tenant_app_pond_growth_override'
  ) THEN
    CREATE POLICY tenant_app_pond_growth_override ON "PondGrowthOverride"
      FOR ALL TO optifeed_app
      USING (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "PondGrowthOverride"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM "Pond" p
          WHERE p.id = "PondGrowthOverride"."pondId"
            AND p."ownerId" = ANY (string_to_array(current_setting('app.farm_ids', true), ','))
        )
      );
  END IF;
END $$;
