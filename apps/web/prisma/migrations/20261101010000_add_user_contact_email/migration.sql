-- Issue #449: a deliverable email for each account.
--
-- `User.email` is the synthetic login address (<login-id>@pond.optifeed.local)
-- that sign-in derives from the farm ID; it can never receive mail and must
-- not change, or the farm ID would stop signing in. Password-reset links need
-- a real mailbox, so an administrator can now record one separately.
--
-- Additive only: one nullable column and a unique index over it. No default,
-- no data rewrite; every existing row reads null until an administrator sets
-- an address. NULLs are distinct in a Postgres unique index, so any number of
-- accounts may stay without one.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_contactEmail_key" ON "User"("contactEmail");
