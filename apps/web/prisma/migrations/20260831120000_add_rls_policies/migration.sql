-- Enable Row-Level Security on all user-facing tables.
-- The SUPABASE_SERVICE_ROLE_KEY (used by Prisma server-side) bypasses RLS,
-- so server-side queries still work. This protects the anon key from abuse.
--
-- IMPORTANT: Apply this via Supabase SQL editor or a dedicated migration script.
-- Prisma does not natively support RLS policies.

-- Enable RLS
ALTER TABLE "Pond" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EnergyDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeviceStateEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScheduleCommand" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BiomassLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FishSample" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FcrReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedLevelLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_lockout" ENABLE ROW LEVEL SECURITY;

-- Pond policies
CREATE POLICY "Users can view own ponds" ON "Pond"
    FOR SELECT USING ("ownerId" = current_setting('request.jwt.claims', true)::json->>'email');

CREATE POLICY "Users can update own ponds" ON "Pond"
    FOR UPDATE USING ("ownerId" = current_setting('request.jwt.claims', true)::json->>'email');

-- EnergyDevice policies (via pond ownership)
CREATE POLICY "Users can view devices on own ponds" ON "EnergyDevice"
    FOR SELECT USING (
        "pondId" IN (SELECT id FROM "Pond" WHERE "ownerId" = current_setting('request.jwt.claims', true)::json->>'email')
    );

CREATE POLICY "Users can update devices on own ponds" ON "EnergyDevice"
    FOR UPDATE USING (
        "pondId" IN (SELECT id FROM "Pond" WHERE "ownerId" = current_setting('request.jwt.claims', true)::json->>'email')
    );

-- FeedEvent policies (via device -> pond ownership)
CREATE POLICY "Users can view feed events on own devices" ON "FeedEvent"
    FOR SELECT USING (
        "deviceId" IN (
            SELECT ed.id FROM "EnergyDevice" ed
            JOIN "Pond" p ON ed."pondId" = p.id
            WHERE p."ownerId" = current_setting('request.jwt.claims', true)::json->>'email'
        )
    );

-- FeedRequest policies
CREATE POLICY "Users can view feed requests on own devices" ON "FeedRequest"
    FOR SELECT USING (
        "deviceId" IN (
            SELECT ed.id FROM "EnergyDevice" ed
            JOIN "Pond" p ON ed."pondId" = p.id
            WHERE p."ownerId" = current_setting('request.jwt.claims', true)::json->>'email'
        )
    );

-- DeviceStateEvent policies
CREATE POLICY "Users can view state events on own devices" ON "DeviceStateEvent"
    FOR SELECT USING (
        "deviceId" IN (
            SELECT ed.id FROM "EnergyDevice" ed
            JOIN "Pond" p ON ed."pondId" = p.id
            WHERE p."ownerId" = current_setting('request.jwt.claims', true)::json->>'email'
        )
    );

-- ScheduleCommand policies
CREATE POLICY "Users can view schedule commands on own ponds" ON "ScheduleCommand"
    FOR SELECT USING (
        "pondId" IN (SELECT id FROM "Pond" WHERE "ownerId" = current_setting('request.jwt.claims', true)::json->>'email')
    );

-- BiomassLog policies
CREATE POLICY "Users can view biomass logs on own ponds" ON "BiomassLog"
    FOR SELECT USING (
        "pondId" IN (SELECT id FROM "Pond" WHERE "ownerId" = current_setting('request.jwt.claims', true)::json->>'email')
    );

-- FishSample policies (via biomass log -> pond ownership)
CREATE POLICY "Users can view fish samples on own ponds" ON "FishSample"
    FOR SELECT USING (
        "biomassLogId" IN (
            SELECT bl.id FROM "BiomassLog" bl
            JOIN "Pond" p ON bl."pondId" = p.id
            WHERE p."ownerId" = current_setting('request.jwt.claims', true)::json->>'email'
        )
    );

-- FcrReport policies
CREATE POLICY "Users can view FCR reports on own ponds" ON "FcrReport"
    FOR SELECT USING (
        "pondId" IN (SELECT id FROM "Pond" WHERE "ownerId" = current_setting('request.jwt.claims', true)::json->>'email')
    );

-- FeedLevelLog policies
CREATE POLICY "Users can view feed level logs on own devices" ON "FeedLevelLog"
    FOR SELECT USING (
        "deviceId" IN (
            SELECT ed.id FROM "EnergyDevice" ed
            JOIN "Pond" p ON ed."pondId" = p.id
            WHERE p."ownerId" = current_setting('request.jwt.claims', true)::json->>'email'
        )
    );

-- Notification policies
CREATE POLICY "Users can view notifications on own ponds" ON "Notification"
    FOR SELECT USING (
        "pondId" IN (SELECT id FROM "Pond" WHERE "ownerId" = current_setting('request.jwt.claims', true)::json->>'email')
    );

-- UserLockout policies (users can only see their own lockout)
CREATE POLICY "Users can view own lockout" ON "user_lockout"
    FOR SELECT USING ("farmId" = current_setting('request.jwt.claims', true)::json->>'email');
