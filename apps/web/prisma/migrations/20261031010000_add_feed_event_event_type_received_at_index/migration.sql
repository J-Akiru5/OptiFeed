-- I-103 (#338): serve the two recurring FeedEvent predicates that filter on
-- eventType plus a receivedAt range:
--   * the platform feed aggregate (eventType = 'feed_dispensed', receivedAt window)
--   * the heartbeat retention sweep (eventType = 'heartbeat', receivedAt < cutoff)
--
-- Additive only: one index, no column, row or constraint change.
--
-- Deliberately NOT CONCURRENTLY: the project convention runs migrations in a
-- transaction and no existing migration uses it. On a large FeedEvent table a
-- plain CREATE INDEX holds a SHARE lock that blocks writes for the build; the
-- integration note records that risk and suggests building it in a maintenance
-- window or as a separately executed CONCURRENTLY statement if the table is big.

CREATE INDEX IF NOT EXISTS "FeedEvent_eventType_receivedAt_idx" ON "FeedEvent"("eventType", "receivedAt");
