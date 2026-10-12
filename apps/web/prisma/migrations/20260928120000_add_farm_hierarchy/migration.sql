-- Farm hierarchy: Farmer (User) → 1 Farm → N Ponds.
-- Hand-written (applied via `prisma db execute` + `migrate resolve`) because the
-- migration history has pre-existing drift and `migrate dev` demands a reset.

-- CreateTable
CREATE TABLE "Farm" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Farm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Farm_ownerId_key" ON "Farm"("ownerId");

-- CreateIndex
CREATE INDEX "Farm_ownerId_idx" ON "Farm"("ownerId");

-- AddForeignKey (1 farm per farmer; deleting the farmer removes the farm)
ALTER TABLE "Farm" ADD CONSTRAINT "Farm_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("farmId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: exactly one Farm per existing User
INSERT INTO "Farm" ("id", "ownerId", "name", "createdAt", "updatedAt")
SELECT 'farm_' || u."farmId", u."farmId", COALESCE(u."displayName", u."farmId") || ' Farm', NOW(), NOW()
FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "Farm" f WHERE f."ownerId" = u."farmId");

-- AddColumn
ALTER TABLE "Pond" ADD COLUMN "farmId" TEXT;

-- Backfill: attach every pond to its owner's farm.
-- Deliberately NOT guarded by EXISTS — if an orphan pond exists this leaves
-- farmId NULL and the following SET NOT NULL aborts the migration loudly.
UPDATE "Pond" p
SET "farmId" = f."id"
FROM "Farm" f
WHERE f."ownerId" = p."ownerId";

-- AlterColumn
ALTER TABLE "Pond" ALTER COLUMN "farmId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Pond_farmId_idx" ON "Pond"("farmId");

-- AddForeignKey (deleting a farm removes its ponds)
ALTER TABLE "Pond" ADD CONSTRAINT "Pond_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
