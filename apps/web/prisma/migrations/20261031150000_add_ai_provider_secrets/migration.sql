-- Issue #432: let superadmin store provider API keys encrypted at rest, and
-- add console-created OpenAI-compatible provider instances.
--
-- Additive only: nullable columns on AiProviderConfig, no default, no data
-- rewrite. Existing rows keep reading `apiKeyEnv` exactly as before; the new
-- `kind` stays null (provider id doubles as the adapter id) and no key
-- material exists until an operator saves one.

ALTER TABLE "AiProviderConfig"
    ADD COLUMN IF NOT EXISTS "kind" TEXT,
    ADD COLUMN IF NOT EXISTS "label" TEXT,
    ADD COLUMN IF NOT EXISTS "baseUrl" TEXT,
    ADD COLUMN IF NOT EXISTS "keyCiphertext" BYTEA,
    ADD COLUMN IF NOT EXISTS "keyIv" BYTEA,
    ADD COLUMN IF NOT EXISTS "keyTag" BYTEA,
    ADD COLUMN IF NOT EXISTS "keyVersion" INTEGER,
    ADD COLUMN IF NOT EXISTS "keyLast4" TEXT,
    ADD COLUMN IF NOT EXISTS "keyUpdatedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "keyUpdatedBy" TEXT;
