-- #589: one dispensed event per dispatched feed request.
--
-- The ingest route's feedRequestId guard was check-then-insert, so two
-- concurrent posts with the same feed_request_id could both pass and
-- double-count the dose. This partial unique index closes the race; the route
-- catches P2002 and answers 204. It constrains every `feed_dispensed` row with
-- a non-null request id, whatever the source; heartbeats, schedule acks and
-- unattributed dispenses (feedRequestId NULL) are untouched. Imported
-- `feed_dispensed` rows carry the same obligation: an import must use unique
-- request ids.
--
-- Production check before this migration (2026-11-02): 238 request-linked
-- `feed_dispensed` rows, 0 duplicate groups, so no cleanup is required.
--
-- SHARE lock: the table is small, and blocking writers while the unique index
-- builds prevents a concurrent insert from committing a duplicate mid-build.
LOCK TABLE "FeedEvent" IN SHARE ROW EXCLUSIVE MODE;
CREATE UNIQUE INDEX IF NOT EXISTS "FeedEvent_feed_dispensed_request_key"
ON "FeedEvent" ("feedRequestId")
WHERE "eventType" = 'feed_dispensed' AND "feedRequestId" IS NOT NULL;
