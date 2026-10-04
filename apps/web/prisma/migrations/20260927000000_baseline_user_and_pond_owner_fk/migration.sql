-- Baseline: recreate the objects that exist in the live database but were
-- never captured by a migration (UserRole enum, User table, Pond→User FK).
-- Captured from information_schema/pg_catalog on 2026-10-04.
--
-- Fully guarded and idempotent — safe to replay on databases that already
-- have these objects (the local dev database does).

-- 1) UserRole enum (matches prisma/schema.prisma enum UserRole)
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_type t
		JOIN pg_namespace n ON n.oid = t.typnamespace
		WHERE t.typname = 'UserRole' AND n.nspname = 'public'
	) THEN
		CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');
	END IF;
END
$$;

-- 2) User table + indexes (DDL captured from the live database)
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'User'
	) THEN
		CREATE TABLE "User" (
			"id" TEXT NOT NULL,
			"supabaseId" TEXT NOT NULL,
			"farmId" TEXT NOT NULL,
			"email" TEXT NOT NULL,
			"displayName" TEXT,
			"role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
			"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"updatedAt" TIMESTAMP(3) NOT NULL,

			CONSTRAINT "User_pkey" PRIMARY KEY ("id")
		);

		CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
		CREATE INDEX "User_farmId_idx" ON "User"("farmId");
		CREATE UNIQUE INDEX "User_farmId_key" ON "User"("farmId");
		CREATE INDEX "User_role_idx" ON "User"("role");
		CREATE UNIQUE INDEX "User_supabaseId_key" ON "User"("supabaseId");
	END IF;
END
$$;

-- 3) Pond.ownerId → User.farmId FK (missing from 20260707130129_fresh_migrate)
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'Pond_ownerId_fkey'
			AND conrelid = '"Pond"'::regclass
	) THEN
		ALTER TABLE "Pond"
			ADD CONSTRAINT "Pond_ownerId_fkey"
			FOREIGN KEY ("ownerId") REFERENCES "User"("farmId")
			ON UPDATE CASCADE ON DELETE RESTRICT;
	END IF;
END
$$;
