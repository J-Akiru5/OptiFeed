-- I-99 (#371): keep unsaved pond-settings form values in the database so a
-- draft survives a closed browser and belongs to exactly one (pond, user).
-- Additive only: one new table, no column or enum change to an existing table.
--
-- `data` holds the form values only (no secrets, tokens or passwords).
-- `deviceId` is the pond's feeder at save time; deleting that feeder clears the
-- link (SET NULL) and keeps the draft. Deleting the pond or the user removes
-- the draft (CASCADE). Timestamp is later than 20261030010000.

CREATE TABLE IF NOT EXISTS "PondSettingsDraft" (
    "id" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PondSettingsDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PondSettingsDraft_pondId_userId_key" ON "PondSettingsDraft"("pondId", "userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PondSettingsDraft_pondId_idx" ON "PondSettingsDraft"("pondId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PondSettingsDraft_deviceId_idx" ON "PondSettingsDraft"("deviceId");

-- AddForeignKey

-- Guarded so a re-run after partial application does not fail on an existing
-- constraint. The FK targets match schema.prisma exactly.
DO $$
BEGIN
    ALTER TABLE "PondSettingsDraft" ADD CONSTRAINT "PondSettingsDraft_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "Pond"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "PondSettingsDraft" ADD CONSTRAINT "PondSettingsDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "PondSettingsDraft" ADD CONSTRAINT "PondSettingsDraft_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "EnergyDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Deny-by-default for PostgREST roles, same as the other core tables. The app
-- connects as the owner role, which bypasses RLS. Do NOT add FORCE.
ALTER TABLE "PondSettingsDraft" ENABLE ROW LEVEL SECURITY;
