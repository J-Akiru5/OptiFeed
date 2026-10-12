-- Task 2.4: hash device tokens at rest.
--
-- Adds EnergyDevice.tokenHash (sha256 of the plaintext token, hex) and
-- backfills every existing row. All device auth (ingest, feed-command,
-- schedule-sync) looks up by tokenHash and compares with timingSafeEqual.
-- The plaintext `token` column is retained for provisioning display and
-- rotation only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "EnergyDevice" ADD COLUMN IF NOT EXISTS "tokenHash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "EnergyDevice_tokenHash_key"
  ON "EnergyDevice"("tokenHash");

UPDATE "EnergyDevice"
SET "tokenHash" = encode(digest("token", 'sha256'), 'hex')
WHERE "tokenHash" IS NULL;
