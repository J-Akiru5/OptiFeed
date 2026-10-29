-- Minimal Supabase-compatible baseline for the restore drill.
--
-- The committed migrations were written against a Supabase project, so two
-- provider-managed objects are assumed to exist before `prisma migrate deploy`
-- runs. A stock postgres:16 container does not have them:
--
--   * roles `anon` and `authenticated`
--       granted to by 20261004030000_add_pond_ownership_history
--       (`GRANT SELECT ON "PondOwnershipHistory" TO anon, authenticated;`)
--   * table `storage.buckets`
--       inserted into by 20261027040000_add_user_avatar
--       (`INSERT INTO storage.buckets ... VALUES ('avatars', ...)`)
--
-- This file recreates only those two objects. It is NOT a migration, it is not
-- applied to production, and it must never be used to change the real Supabase
-- project. The drill runs it against its own throwaway container so the
-- migrations can be applied exactly as committed.
--
-- Idempotent: safe to run more than once.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'CREATE ROLE anon NOLOGIN';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'CREATE ROLE authenticated NOLOGIN';
    END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS storage;

-- Only the columns the migration touches. Supabase's real table has more
-- (owner, metadata, created_at, ...); the drill never reads them.
CREATE TABLE IF NOT EXISTS storage.buckets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    public BOOLEAN NOT NULL DEFAULT false,
    file_size_limit BIGINT,
    allowed_mime_types TEXT[]
);
