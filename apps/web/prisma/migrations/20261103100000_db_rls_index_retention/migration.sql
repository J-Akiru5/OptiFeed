-- #593: RLS containment, list indexes, and a documented service-role boundary.
--
-- Pre-flight (read-only, 2026-11-02): the app connects through the Supabase
-- pooler as `postgres`; `current_user` is `postgres`, it owns every public
-- table, and `pg_roles.rolbypassrls = true`. Enabling RLS therefore does not
-- affect the Prisma app. `anon` and `authenticated` have no grants on the
-- tables below, so RLS without policies is an explicit deny.
--
-- `_prisma_migrations` is a Prisma internal and is intentionally excluded.
-- The service-role-only list is documented in docs/database-rls-retention.md.

ALTER TABLE "AiProviderConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BackgroundJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CropCycle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Device" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ErrorEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedingEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImpersonationSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IssueReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobArtifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MembershipPermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MortalityLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformAdmin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PondEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReminderLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "login_lockout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_limit_bucket" ENABLE ROW LEVEL SECURITY;

-- PondOwnershipHistory is the only table that grants the Supabase public API
-- roles anything. The app does not use client-side Supabase reads, so this is
-- made explicitly service-role-only. Its existing RLS policy remains for a
-- future reviewed grant; the revoke is the containment boundary.
REVOKE ALL PRIVILEGES ON TABLE "PondOwnershipHistory" FROM anon, authenticated;

-- Notification list: filter by pond/farm and order newest-first.
CREATE INDEX IF NOT EXISTS "Notification_pondId_createdAt_idx"
ON "Notification" ("pondId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_farmId_createdAt_idx"
ON "Notification" ("farmId", "createdAt");

-- Global platform activity: "all activity, newest first" has no leading
-- createdAt index today.
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_createdAt_idx"
ON "PlatformAuditLog" ("createdAt");
