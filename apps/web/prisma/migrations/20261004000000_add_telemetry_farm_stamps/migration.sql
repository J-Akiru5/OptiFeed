-- Telemetry ownership stamps (EMS rule): every telemetry row carries the
-- Farm it belonged to at write time.
--
-- * farmId TEXT (nullable) — NULL means "device had no pond assigned at
--   write time" (the EMS site_id-while-uninstalled analog).
-- * NO foreign key to Farm — the stamp is immutable history and must
--   survive farm lifecycle (deletes/transfers).
-- * Stamping happens in a BEFORE INSERT trigger so every writer is covered
--   (app code, seeds, CLI, import routes, future code) with zero app churn.

-- ── 1. Columns ───────────────────────────────────────────────────────────────
ALTER TABLE "FeedEvent" ADD COLUMN "farmId" TEXT;
ALTER TABLE "FeedRequest" ADD COLUMN "farmId" TEXT;
ALTER TABLE "DeviceStateEvent" ADD COLUMN "farmId" TEXT;
ALTER TABLE "FeedLevelLog" ADD COLUMN "farmId" TEXT;
ALTER TABLE "BiomassLog" ADD COLUMN "farmId" TEXT;
ALTER TABLE "FcrReport" ADD COLUMN "farmId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "farmId" TEXT;
ALTER TABLE "ScheduleCommand" ADD COLUMN "farmId" TEXT;
ALTER TABLE "FishSample" ADD COLUMN "farmId" TEXT;

-- ── 2. Backfill from current ownership ───────────────────────────────────────
-- pondId-keyed tables
UPDATE "BiomassLog" t SET "farmId" = p."farmId" FROM "Pond" p WHERE t."pondId" = p.id;
UPDATE "FcrReport" t SET "farmId" = p."farmId" FROM "Pond" p WHERE t."pondId" = p.id;
UPDATE "Notification" t SET "farmId" = p."farmId" FROM "Pond" p WHERE t."pondId" = p.id;
UPDATE "ScheduleCommand" t SET "farmId" = p."farmId" FROM "Pond" p WHERE t."pondId" = p.id;

-- device-keyed tables (device → pond; unassigned devices stay NULL)
UPDATE "FeedEvent" t SET "farmId" = p."farmId"
	FROM "EnergyDevice" e JOIN "Pond" p ON e."pondId" = p.id
	WHERE t."deviceId" = e.id;
UPDATE "FeedRequest" t SET "farmId" = p."farmId"
	FROM "EnergyDevice" e JOIN "Pond" p ON e."pondId" = p.id
	WHERE t."deviceId" = e.id;
UPDATE "DeviceStateEvent" t SET "farmId" = p."farmId"
	FROM "EnergyDevice" e JOIN "Pond" p ON e."pondId" = p.id
	WHERE t."deviceId" = e.id;
UPDATE "FeedLevelLog" t SET "farmId" = p."farmId"
	FROM "EnergyDevice" e JOIN "Pond" p ON e."pondId" = p.id
	WHERE t."deviceId" = e.id;

-- biomass-log-keyed table
UPDATE "FishSample" t SET "farmId" = p."farmId"
	FROM "BiomassLog" bl JOIN "Pond" p ON bl."pondId" = p.id
	WHERE t."biomassLogId" = bl.id;

-- ── 3. Indexes (RLS policies read the stamp directly) ────────────────────────
CREATE INDEX "FeedEvent_farmId_idx" ON "FeedEvent"("farmId");
CREATE INDEX "FeedRequest_farmId_idx" ON "FeedRequest"("farmId");
CREATE INDEX "DeviceStateEvent_farmId_idx" ON "DeviceStateEvent"("farmId");
CREATE INDEX "FeedLevelLog_farmId_idx" ON "FeedLevelLog"("farmId");
CREATE INDEX "BiomassLog_farmId_idx" ON "BiomassLog"("farmId");
CREATE INDEX "FcrReport_farmId_idx" ON "FcrReport"("farmId");
CREATE INDEX "Notification_farmId_idx" ON "Notification"("farmId");
CREATE INDEX "ScheduleCommand_farmId_idx" ON "ScheduleCommand"("farmId");
CREATE INDEX "FishSample_farmId_idx" ON "FishSample"("farmId");

-- ── 4. Auto-stamp trigger ────────────────────────────────────────────────────
-- Resolves farmId from the row's pond (directly, via device, or via biomass
-- log depending on table). Respects an explicitly supplied stamp (COALESCE).
CREATE OR REPLACE FUNCTION stamp_telemetry_farm_id() RETURNS trigger AS $$
DECLARE
	resolved TEXT;
BEGIN
	IF NEW."farmId" IS NOT NULL THEN
		RETURN NEW;
	END IF;

	IF TG_TABLE_NAME IN ('BiomassLog', 'FcrReport', 'Notification', 'ScheduleCommand') THEN
		SELECT p."farmId" INTO resolved FROM "Pond" p WHERE p.id = NEW."pondId";
	ELSIF TG_TABLE_NAME IN ('FeedEvent', 'FeedRequest', 'DeviceStateEvent', 'FeedLevelLog') THEN
		SELECT p."farmId" INTO resolved
		FROM "EnergyDevice" e JOIN "Pond" p ON e."pondId" = p.id
		WHERE e.id = NEW."deviceId";
	ELSIF TG_TABLE_NAME = 'FishSample' THEN
		SELECT p."farmId" INTO resolved
		FROM "BiomassLog" bl JOIN "Pond" p ON bl."pondId" = p.id
		WHERE bl.id = NEW."biomassLogId";
	END IF;

	NEW."farmId" := resolved;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stamp_telemetry_farm_id BEFORE INSERT ON "FeedEvent"
	FOR EACH ROW EXECUTE FUNCTION stamp_telemetry_farm_id();
CREATE TRIGGER stamp_telemetry_farm_id BEFORE INSERT ON "FeedRequest"
	FOR EACH ROW EXECUTE FUNCTION stamp_telemetry_farm_id();
CREATE TRIGGER stamp_telemetry_farm_id BEFORE INSERT ON "DeviceStateEvent"
	FOR EACH ROW EXECUTE FUNCTION stamp_telemetry_farm_id();
CREATE TRIGGER stamp_telemetry_farm_id BEFORE INSERT ON "FeedLevelLog"
	FOR EACH ROW EXECUTE FUNCTION stamp_telemetry_farm_id();
CREATE TRIGGER stamp_telemetry_farm_id BEFORE INSERT ON "BiomassLog"
	FOR EACH ROW EXECUTE FUNCTION stamp_telemetry_farm_id();
CREATE TRIGGER stamp_telemetry_farm_id BEFORE INSERT ON "FcrReport"
	FOR EACH ROW EXECUTE FUNCTION stamp_telemetry_farm_id();
CREATE TRIGGER stamp_telemetry_farm_id BEFORE INSERT ON "Notification"
	FOR EACH ROW EXECUTE FUNCTION stamp_telemetry_farm_id();
CREATE TRIGGER stamp_telemetry_farm_id BEFORE INSERT ON "ScheduleCommand"
	FOR EACH ROW EXECUTE FUNCTION stamp_telemetry_farm_id();
CREATE TRIGGER stamp_telemetry_farm_id BEFORE INSERT ON "FishSample"
	FOR EACH ROW EXECUTE FUNCTION stamp_telemetry_farm_id();
