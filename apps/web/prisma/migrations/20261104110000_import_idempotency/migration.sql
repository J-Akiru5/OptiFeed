-- Issue #723: a repeated import confirm must not insert the dataset twice.
--
-- ADDITIVE ONLY: one new table, its unique/retention indexes and RLS enabled
-- with no policy (the same service-role-only default as BackgroundJob and
-- JobArtifact in 20261103100000_db_rls_index_retention). No existing table,
-- column, row, constraint or policy is touched.
--
-- The write is in the same transaction as the imported rows, so a failed
-- import leaves no confirmation behind and the same key can be retried. The
-- unique (ownerId, idempotencyKey) pair is what resolves a concurrent replay:
-- one transaction commits, the other gets P2002 and returns the winner's
-- already-committed result.

CREATE TABLE "ImportConfirmation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportConfirmation_ownerId_idempotencyKey_key"
ON "ImportConfirmation"("ownerId", "idempotencyKey");

-- Supports a future retention sweep (confirmed imports are only needed long
-- enough to absorb client retries).
CREATE INDEX "ImportConfirmation_createdAt_idx" ON "ImportConfirmation"("createdAt");

ALTER TABLE "ImportConfirmation" ENABLE ROW LEVEL SECURITY;
