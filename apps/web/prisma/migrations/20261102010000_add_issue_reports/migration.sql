-- Issue #487: reports from the public landing page ("Report an issue").
--
-- ADDITIVE ONLY. Three new enums, one new table and one index. No existing
-- table, column, constraint, policy or row is touched, renamed or dropped.
-- The matching Prisma model is `IssueReport` in prisma/schema.prisma.
--
-- No foreign keys by design: the public form is anonymous, `reporterUserId`
-- may reference an account that is later deleted, and a report must survive
-- that deletion so the superadmin can still read it.

CREATE TYPE "IssueReportCategory" AS ENUM ('BUG', 'ACCESSIBILITY', 'CONTENT', 'OTHER');

CREATE TYPE "IssueReportSource" AS ENUM ('PUBLIC', 'ASSISTANT');

CREATE TYPE "IssueReportStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE IF NOT EXISTS "IssueReport" (
    "id" TEXT NOT NULL,
    "category" "IssueReportCategory" NOT NULL DEFAULT 'OTHER',
    "message" TEXT NOT NULL,
    "email" TEXT,
    "pagePath" TEXT,
    "locale" TEXT,
    "source" "IssueReportSource" NOT NULL DEFAULT 'PUBLIC',
    "reporterUserId" TEXT,
    "status" "IssueReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IssueReport_pkey" PRIMARY KEY ("id")
);

-- Superadmin queue: open reports, newest first.
CREATE INDEX IF NOT EXISTS "IssueReport_status_createdAt_idx" ON "IssueReport"("status", "createdAt");
