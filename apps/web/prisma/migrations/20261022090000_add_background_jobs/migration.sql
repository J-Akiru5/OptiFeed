-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "requestedBy" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobArtifact" (
    "jobId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobArtifact_pkey" PRIMARY KEY ("jobId")
);

-- CreateIndex
CREATE INDEX "BackgroundJob_status_createdAt_idx" ON "BackgroundJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_ownerId_createdAt_idx" ON "BackgroundJob"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_expiresAt_idx" ON "BackgroundJob"("expiresAt");

-- AddForeignKey
ALTER TABLE "JobArtifact" ADD CONSTRAINT "JobArtifact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BackgroundJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
