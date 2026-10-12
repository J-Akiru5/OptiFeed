-- Task 2.3: RLS on User — deny-by-default.
--
-- No policies are created, so anon/authenticated PostgREST roles see
-- zero rows. The app's Prisma connection (owner/service role) bypasses
-- RLS, so runtime behavior is unchanged. This is the same pattern the
-- other core tables already use (20261004 fix-migration).
--
-- Do NOT add FORCE ROW LEVEL SECURITY — that would also apply the deny
-- policies to the table owner and break the app.

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
