-- Bootstrap: give every legacy ADMIN user a solo tenant org + OWNER membership.
--
-- Prerequisite for org-scoped /admin queries: without a membership, scoping
-- resolves to an empty scope (fail-closed) and every existing account would
-- see a blank admin console. demo-farmer-1 is currently the only such account.
--
-- Only role='ADMIN' is backfilled. role='VIEWER' is excluded deliberately —
-- the superadmin holds no membership at all, because it is global rather than
-- scoped to any one tenant. role='OPERATOR' is excluded because farmers are
-- onboarded through the pond flow or the platform console, both of which create
-- the membership as part of the same transaction.
--
-- Idempotent: the NOT EXISTS guard means a re-run inserts zero rows.
-- Loop variable and table alias are named distinctly: PL/pgSQL cannot resolve
-- an unqualified `alias.column` when it collides with a record variable.

DO $$
DECLARE
    rec RECORD;
    new_org_id TEXT;
BEGIN
    FOR rec IN
        SELECT usr."id" AS user_id, usr."displayName" AS display_name
        FROM "User" usr
        WHERE usr."role" = 'ADMIN'
          AND NOT EXISTS (
              SELECT 1 FROM "Membership" m
              WHERE m."userId" = usr."id"
                AND m."revokedAt" IS NULL
          )
    LOOP
        -- cuid() is client-side, so the id is minted here.
        new_org_id := gen_random_uuid()::text;

        INSERT INTO "Organization"
            ("id", "name", "type", "status", "createdAt", "updatedAt")
        VALUES
            (new_org_id,
             COALESCE(rec.display_name, rec.user_id) || ' (independent)',
             'INDIVIDUAL',
             'ACTIVE',
             NOW(),
             NOW());

        INSERT INTO "Membership"
            ("id", "orgId", "userId", "role", "createdAt")
        VALUES
            (gen_random_uuid()::text, new_org_id, rec.user_id, 'OWNER', NOW());
    END LOOP;
END $$;
