-- Issue #479, M3C.6: the platform incident lifecycle (plan decisions O19/O20).
--
-- ADDITIVE ONLY. Four new enums and two new tables. No existing table, column,
-- constraint, policy or row is touched, renamed or dropped.
--
-- OPERATIONAL ORDER: take a full platform backup (Superadmin > Settings >
-- Backup) before applying this to any hosted database. CI applies it only to
-- the disposable local Supabase stack; this change did not run it anywhere.
--
-- No foreign keys to Pond / EnergyDevice / User by design: an incident is a
-- record of what happened and must survive the subject's deletion. The only FK
-- is the timeline's parent, which cascades with the incident itself.
--
-- `dedupeKey` is unique: a repeating condition updates the same row instead of
-- opening a second incident.

-- CreateEnum
CREATE TYPE "PlatformIncidentSource" AS ENUM ('DEVICE_OFFLINE', 'SAFE_MODE', 'FAULT', 'FAILED_JOB', 'NOTIFICATION', 'MANUAL');

-- CreateEnum
CREATE TYPE "PlatformIncidentSeverity" AS ENUM ('CRITICAL', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "PlatformIncidentStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "PlatformIncidentEventType" AS ENUM ('AUTO_OPENED', 'AUTO_RESOLVED', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'ESCALATED', 'NOTIFIED');

-- CreateTable
CREATE TABLE IF NOT EXISTS "PlatformIncident" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "source" "PlatformIncidentSource" NOT NULL,
    "severity" "PlatformIncidentSeverity" NOT NULL,
    "status" "PlatformIncidentStatus" NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "orgId" TEXT,
    "farmId" TEXT,
    "deviceId" TEXT,
    "pondId" TEXT,
    "ownerId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "ackDueAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PlatformIncidentEvent" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "type" "PlatformIncidentEventType" NOT NULL,
    "fromStatus" "PlatformIncidentStatus",
    "toStatus" "PlatformIncidentStatus",
    "actorId" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformIncidentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformIncident_dedupeKey_key" ON "PlatformIncident"("dedupeKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlatformIncident_status_severity_openedAt_idx" ON "PlatformIncident"("status", "severity", "openedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlatformIncident_orgId_openedAt_idx" ON "PlatformIncident"("orgId", "openedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlatformIncidentEvent_incidentId_createdAt_idx" ON "PlatformIncidentEvent"("incidentId", "createdAt");

-- AddForeignKey
-- Guarded so a re-run after partial application does not fail on an existing
-- constraint. The FK targets match schema.prisma exactly.
DO $$
BEGIN
    ALTER TABLE "PlatformIncidentEvent" ADD CONSTRAINT "PlatformIncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "PlatformIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Deny-by-default for PostgREST roles, the same platform-admin pattern as
-- "User", "PlatformSetting" and "PlatformAuditLog". No policies are created, so
-- anon/authenticated PostgREST roles see zero rows; the app's Prisma owner role
-- bypasses RLS. Do NOT add FORCE ROW LEVEL SECURITY.
ALTER TABLE "PlatformIncident" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformIncidentEvent" ENABLE ROW LEVEL SECURITY;
