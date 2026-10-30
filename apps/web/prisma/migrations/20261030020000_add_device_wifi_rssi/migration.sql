-- I-97: store the Wi-Fi RSSI a feeder reports on its heartbeat.
--
-- Additive and nullable on purpose: no default, no backfill. NULL means "no
-- firmware that reports a signal yet" or "nothing received since the migration",
-- and every reader falls back to the timing-only connectivity rule. Old firmware
-- keeps working unchanged.
ALTER TABLE "EnergyDevice" ADD COLUMN IF NOT EXISTS "wifiRssiDbm" INTEGER;
ALTER TABLE "EnergyDevice" ADD COLUMN IF NOT EXISTS "wifiRssiUpdatedAt" TIMESTAMP(3);
