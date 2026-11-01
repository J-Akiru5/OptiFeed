-- CreateTable
CREATE TABLE "MortalityLog" (
    "id" TEXT NOT NULL,
    "pondId" TEXT NOT NULL,
    "cropCycleId" TEXT,
    "farmId" TEXT,
    "count" INTEGER NOT NULL,
    "reason" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "MortalityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MortalityLog_pondId_recordedAt_idx" ON "MortalityLog"("pondId", "recordedAt");

-- CreateIndex
CREATE INDEX "MortalityLog_cropCycleId_idx" ON "MortalityLog"("cropCycleId");

-- CreateIndex
CREATE INDEX "MortalityLog_farmId_idx" ON "MortalityLog"("farmId");

-- AddForeignKey
ALTER TABLE "MortalityLog" ADD CONSTRAINT "MortalityLog_pondId_fkey" FOREIGN KEY ("pondId") REFERENCES "Pond"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MortalityLog" ADD CONSTRAINT "MortalityLog_cropCycleId_fkey" FOREIGN KEY ("cropCycleId") REFERENCES "CropCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
