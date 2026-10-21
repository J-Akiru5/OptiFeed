-- RLS repair + Farm coverage + EMS-style stamped telemetry policies.
--
-- The 20260831120000 policies compared Pond.ownerId (login slug, e.g.
-- 'demo-farmer-1') against the raw JWT email claim
-- ('demo-farmer-1@pond.optifeed.local') — they matched nothing (fail-closed).
-- This migration recreates every policy with the correct predicate:
-- slug = email local-part of the JWT claim.
--
-- Telemetry policies now read each row's OWN stamped farmId (EMS rule:
-- never join to current assignment). Rows with farmId IS NULL (device had no
-- pond at write time) stay invisible — fail-closed.
--
-- NOTE: the app uses the service-role key (bypasses RLS), so no runtime
-- behavior changes; these policies protect anon/authenticated PostgREST access.

-- ── 1. Drop the broken policies ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own ponds" ON "Pond";
DROP POLICY IF EXISTS "Users can update own ponds" ON "Pond";
DROP POLICY IF EXISTS "Users can view devices on own ponds" ON "EnergyDevice";
DROP POLICY IF EXISTS "Users can update devices on own ponds" ON "EnergyDevice";
DROP POLICY IF EXISTS "Users can view feed events on own devices" ON "FeedEvent";
DROP POLICY IF EXISTS "Users can view feed requests on own devices" ON "FeedRequest";
DROP POLICY IF EXISTS "Users can view state events on own devices" ON "DeviceStateEvent";
DROP POLICY IF EXISTS "Users can view schedule commands on own ponds" ON "ScheduleCommand";
DROP POLICY IF EXISTS "Users can view biomass logs on own ponds" ON "BiomassLog";
DROP POLICY IF EXISTS "Users can view fish samples on own ponds" ON "FishSample";
DROP POLICY IF EXISTS "Users can view FCR reports on own ponds" ON "FcrReport";
DROP POLICY IF EXISTS "Users can view feed level logs on own devices" ON "FeedLevelLog";
DROP POLICY IF EXISTS "Users can view notifications on own ponds" ON "Notification";
DROP POLICY IF EXISTS "Users can view own lockout" ON "user_lockout";

-- ── 2. Farm row-level security (new) ────────────────────────────────────────
ALTER TABLE "Farm" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own farm" ON "Farm"
	FOR SELECT USING (
		"ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1))
	);

CREATE POLICY "Users can update own farm" ON "Farm"
	FOR UPDATE USING (
		"ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1))
	);

-- ── 3. Structural policies (fixed predicate) ────────────────────────────────
CREATE POLICY "Users can view own ponds" ON "Pond"
	FOR SELECT USING (
		"ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1))
	);

CREATE POLICY "Users can update own ponds" ON "Pond"
	FOR UPDATE USING (
		"ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1))
	);

CREATE POLICY "Users can view devices on own ponds" ON "EnergyDevice"
	FOR SELECT USING (
		"pondId" IN (
			SELECT id FROM "Pond"
			WHERE "ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1))
		)
	);

CREATE POLICY "Users can update devices on own ponds" ON "EnergyDevice"
	FOR UPDATE USING (
		"pondId" IN (
			SELECT id FROM "Pond"
			WHERE "ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1))
		)
	);

CREATE POLICY "Users can view own lockout" ON "user_lockout"
	FOR SELECT USING (
		"farmId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1))
	);

-- ── 4. Telemetry policies — read the row's own stamped farmId ───────────────
CREATE POLICY "Users can view feed events on own farm" ON "FeedEvent"
	FOR SELECT USING (
		"farmId" IN (SELECT id FROM "Farm" WHERE "ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1)))
	);

CREATE POLICY "Users can view feed requests on own farm" ON "FeedRequest"
	FOR SELECT USING (
		"farmId" IN (SELECT id FROM "Farm" WHERE "ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1)))
	);

CREATE POLICY "Users can view state events on own farm" ON "DeviceStateEvent"
	FOR SELECT USING (
		"farmId" IN (SELECT id FROM "Farm" WHERE "ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1)))
	);

CREATE POLICY "Users can view feed level logs on own farm" ON "FeedLevelLog"
	FOR SELECT USING (
		"farmId" IN (SELECT id FROM "Farm" WHERE "ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1)))
	);

CREATE POLICY "Users can view schedule commands on own farm" ON "ScheduleCommand"
	FOR SELECT USING (
		"farmId" IN (SELECT id FROM "Farm" WHERE "ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1)))
	);

CREATE POLICY "Users can view biomass logs on own farm" ON "BiomassLog"
	FOR SELECT USING (
		"farmId" IN (SELECT id FROM "Farm" WHERE "ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1)))
	);

CREATE POLICY "Users can view fish samples on own farm" ON "FishSample"
	FOR SELECT USING (
		"farmId" IN (SELECT id FROM "Farm" WHERE "ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1)))
	);

CREATE POLICY "Users can view FCR reports on own farm" ON "FcrReport"
	FOR SELECT USING (
		"farmId" IN (SELECT id FROM "Farm" WHERE "ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1)))
	);

CREATE POLICY "Users can view notifications on own farm" ON "Notification"
	FOR SELECT USING (
		"farmId" IN (SELECT id FROM "Farm" WHERE "ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1)))
	);
