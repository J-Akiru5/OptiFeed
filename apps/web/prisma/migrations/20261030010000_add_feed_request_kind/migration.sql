-- A calibration test may exceed the normal per-request feed cap while remaining
-- one deliberate, auditable dose. The kind tells the device-pickup route which
-- cap to apply and lets the firmware raise its per-dose ceiling for this one run.
ALTER TABLE "FeedRequest" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'feed';
