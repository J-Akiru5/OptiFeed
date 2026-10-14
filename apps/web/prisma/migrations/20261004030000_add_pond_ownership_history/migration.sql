-- Immutable pond ownership history (EMS emu_installations analog).
-- One row per ownership event: CREATED on pond insert, TRANSFERRED when
-- Pond.farmId changes. Written by DB triggers — never by app code.
-- farmId/previousFarmId are immutable stamps (no FK to Farm by design).

CREATE TYPE "PondOwnershipEventType" AS ENUM ('CREATED', 'TRANSFERRED');

CREATE TABLE "PondOwnershipHistory" (
	"id" UUID NOT NULL DEFAULT gen_random_uuid(),
	"pondId" TEXT NOT NULL,
	"farmId" TEXT NOT NULL,
	"previousFarmId" TEXT,
	"eventType" "PondOwnershipEventType" NOT NULL,
	"changedById" TEXT,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

	CONSTRAINT "PondOwnershipHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PondOwnershipHistory_pondId_createdAt_idx" ON "PondOwnershipHistory"("pondId", "createdAt");
CREATE INDEX "PondOwnershipHistory_farmId_idx" ON "PondOwnershipHistory"("farmId");

ALTER TABLE "PondOwnershipHistory" ADD CONSTRAINT "PondOwnershipHistory_pondId_fkey"
	FOREIGN KEY ("pondId") REFERENCES "Pond"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one CREATED row per existing pond (timestamp = pond creation).
INSERT INTO "PondOwnershipHistory" ("pondId", "farmId", "eventType", "createdAt")
SELECT p."id", p."farmId", 'CREATED', p."createdAt" FROM "Pond" p;

-- ── Triggers ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_pond_ownership_event() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		INSERT INTO "PondOwnershipHistory" ("pondId", "farmId", "eventType")
		VALUES (NEW."id", NEW."farmId", 'CREATED');
		RETURN NEW;
	END IF;

	IF OLD."farmId" IS DISTINCT FROM NEW."farmId" THEN
		INSERT INTO "PondOwnershipHistory" ("pondId", "farmId", "previousFarmId", "eventType")
		VALUES (NEW."id", NEW."farmId", OLD."farmId", 'TRANSFERRED');
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER record_pond_ownership_event
	AFTER INSERT OR UPDATE OF "farmId" ON "Pond"
	FOR EACH ROW EXECUTE FUNCTION record_pond_ownership_event();

-- ── RLS (stamp-based, same predicate as 20261004010000) ─────────────────────
ALTER TABLE "PondOwnershipHistory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pond ownership history" ON "PondOwnershipHistory"
	FOR SELECT USING (
		"farmId" IN (SELECT id FROM "Farm" WHERE "ownerId" = lower(split_part(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email', '@', 1)))
	);

GRANT SELECT ON "PondOwnershipHistory" TO anon, authenticated;
