-- #581: a device may have at most one pending FeedRequest at a time.
--
-- ADDITIVE ONLY. This migration creates one partial unique index and touches no
-- row. Before creating it, the guard below counts devices with more than one
-- pending request. If any exist (from the read-then-write race this fixes), the
-- migration raises and aborts. It never deletes, updates or guesses which
-- queued dose is authoritative: an operator must resolve the duplicates.
--
-- Prisma cannot declare a partial unique index in schema.prisma, so the index
-- is raw SQL. The application serialises manual feed creation with
-- `SELECT ... FOR UPDATE` on the owning EnergyDevice row and also treats the
-- unique violation (Prisma P2002 / SQLSTATE 23505) as "already pending".
--
-- Future migrations must keep this index: it is deliberately not represented
-- in the Prisma schema, so an automatically generated diff may not preserve it.

-- Block writers while the duplicate check and index creation run, so a request
-- queued between them cannot make the assertion stale. Readers keep running;
-- the unique index build would take this lock anyway.
LOCK TABLE "FeedRequest" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    duplicate_devices BIGINT;
BEGIN
    SELECT COUNT(*) INTO duplicate_devices
    FROM (
        SELECT "deviceId"
        FROM "FeedRequest"
        WHERE "status" = 'pending'
        GROUP BY "deviceId"
        HAVING COUNT(*) > 1
    ) AS duplicates;

    IF duplicate_devices > 0 THEN
        RAISE EXCEPTION
            'FeedRequest has % device(s) with more than one pending request. Resolve them before applying migration 20261102190000; no rows were deleted.',
            duplicate_devices;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "FeedRequest_deviceId_pending_key"
    ON "FeedRequest" ("deviceId")
    WHERE "status" = 'pending';
