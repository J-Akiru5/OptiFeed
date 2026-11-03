-- Issue #718: completePasswordReset accepted any authenticated session, so a
-- stolen/shared session could set a permanent password without knowing the
-- current one (CWE-620). A reset now carries a signed, single-use proof minted
-- when the recovery link is requested; this table stores only its `jti`, never
-- the token itself.
--
-- ADDITIVE ONLY: one new table with its primary key, one unique index and one
-- lookup index. No existing table, column, constraint, policy or row is
-- touched. `userId` has no foreign key by design: the row is short-lived and
-- expired rows can be pruned without cascading through `User`.
--
-- Not applied by this change. Production applies it through the documented
-- `main` deployment path; `staging` builds skip migrations.

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_jti_key" ON "PasswordResetToken"("jti");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
