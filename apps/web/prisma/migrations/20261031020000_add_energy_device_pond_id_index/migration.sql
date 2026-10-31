-- I-103 (#339): EnergyDevice is filtered by pondId on the dashboard's first
-- read, the calendar device lookup, global search and the notification
-- acknowledgement path. Postgres does not index a foreign key on its own.
--
-- Additive only: one index, no column, row or constraint change. The table is
-- small (one row per feeder), so a plain CREATE INDEX is lock-light here.

CREATE INDEX IF NOT EXISTS "EnergyDevice_pondId_idx" ON "EnergyDevice"("pondId");
