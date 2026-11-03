-- Issue #747: the dashboard notification provider subscribes to
-- `postgres_changes` on "Notification", but no migration ever added the table
-- to the `supabase_realtime` publication. Unless the hosted project was
-- configured by hand, inserts and escalations never reached the browser and the
-- only fallback was the 30-second layout refresh.
--
-- Guarded on both sides so this is safe on a plain PostgreSQL database (no
-- Supabase publication) and re-runnable if the table is already a member.
-- ADDITIVE ONLY: no table, column, policy or row is touched.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'Notification'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "Notification";
  END IF;
END
$$;
