-- Issues #194 (assistant actions) and #195/#196 (calendar items). Additive only.

-- CreateEnum
CREATE TYPE "PondItemKind" AS ENUM ('EVENT', 'TASK');

-- CreateEnum
CREATE TYPE "RecurrenceFreq" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AssistantActionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'FAILED');

-- AlterTable
ALTER TABLE "PondEvent" ADD COLUMN     "color" TEXT,
ADD COLUMN     "completedOccurrences" TIMESTAMP(3)[] DEFAULT ARRAY[]::TIMESTAMP(3)[],
ADD COLUMN     "kind" "PondItemKind" NOT NULL DEFAULT 'EVENT',
ADD COLUMN     "recurrenceFreq" "RecurrenceFreq",
ADD COLUMN     "recurrenceInterval" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "recurrenceUntil" TIMESTAMP(3),
ADD COLUMN     "reminderMinutes" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "AssistantAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "pondId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "AssistantActionStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantAction_userId_status_createdAt_idx" ON "AssistantAction"("userId", "status", "createdAt");

-- Deny-by-default for PostgREST roles (see 20261013020000). Do NOT add FORCE.
ALTER TABLE "AssistantAction" ENABLE ROW LEVEL SECURITY;
