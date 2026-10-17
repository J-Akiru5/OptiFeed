-- M1.1 (plan SUPERADMIN-MULTITENANCY-PLAN §3.2, §8): multi-tenancy foundation
-- and the superadmin source of truth.
--
-- Hand-written and applied via `prisma db execute` + `migrate resolve`, matching
-- the precedent in 20260928120000_add_farm_hierarchy: the migration history has
-- pre-existing drift and `migrate dev` demands a reset, which is forbidden here.
--
-- Additive only: CREATE TYPE / TABLE / INDEX / TRIGGER plus one idempotent
-- INSERT. Nothing existing is removed or altered.
--
-- PlatformAuditLog is append-only (T5: every superadmin action writes a reason-
-- stamped audit row, and that row must never be editable or deletable). The
-- trigger raises on UPDATE and DELETE.
--
-- PlatformAdmin is backfilled from the legacy god-role (plan M1.4, inlined):
-- every User with role = ADMIN becomes a PlatformAdmin so no environment can be
-- left without a superadmin after this migration. Idempotent via ON CONFLICT.

-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('INDIVIDUAL', 'COOPERATIVE', 'COMPANY', 'LGU', 'ACADEMIC');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION', 'PURGED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrgType" NOT NULL DEFAULT 'INDIVIDUAL',
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "parentId" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "deletionRequestedAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "invitedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipPermission" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MembershipPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "mfaEnrolledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "orgId" TEXT,
    "reason" TEXT NOT NULL,
    "stepUpAt" TIMESTAMP(3),
    "temporaryGrant" BOOLEAN NOT NULL DEFAULT false,
    "impersonationId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpersonationSession" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ImpersonationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_orgId_userId_key" ON "Membership"("orgId", "userId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPermission_membershipId_permission_key" ON "MembershipPermission"("membershipId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_userId_key" ON "PlatformAdmin"("userId");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_orgId_createdAt_idx" ON "PlatformAuditLog"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_actorUserId_createdAt_idx" ON "PlatformAuditLog"("actorUserId", "createdAt");

-- Append-only guard (T5): reject UPDATE and DELETE on the audit log.
CREATE OR REPLACE FUNCTION enforce_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% on append-only table % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER PlatformAuditLog_append_only
    BEFORE UPDATE OR DELETE ON "PlatformAuditLog"
    FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

-- Backfill (M1.4, inlined): every legacy ADMIN user becomes a PlatformAdmin.
-- cuid() is client-side, so the id is minted here with gen_random_uuid().
-- Idempotent: a re-run inserts zero rows.
INSERT INTO "PlatformAdmin" ("id", "userId", "grantedBy", "createdAt")
SELECT gen_random_uuid()::text, u."id", 'migration-backfill', NOW()
FROM "User" u
WHERE u."role" = 'ADMIN'
ON CONFLICT ("userId") DO NOTHING;
