-- #747: publish Notification changes to Supabase Realtime.
--
-- The notification provider subscribes to INSERT and UPDATE. Hosted Supabase
-- only streams `postgres_changes` for tables that belong to the
-- `supabase_realtime` publication, so the table has to be provisioned here
-- rather than left to a dashboard toggle that no environment record captures.
--
-- The block is a no-op when:
--   * the publication does not exist (plain PostgreSQL, restore drills), or
--   * the publication is FOR ALL TABLES (every table is already published), or
--   * the table is already a member (re-run / manually provisioned project).
--
-- RLS is unchanged: the existing "Users can view notifications on own farm"
-- SELECT policy still scopes rows for the authenticated Supabase role.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_publication
		WHERE pubname = 'supabase_realtime'
			AND puballtables = false
	) AND NOT EXISTS (
		SELECT 1
		FROM pg_publication_tables
		WHERE pubname = 'supabase_realtime'
			AND schemaname = 'public'
			AND tablename = 'Notification'
	) THEN
		EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public."Notification"';
	END IF;
END
$$;
