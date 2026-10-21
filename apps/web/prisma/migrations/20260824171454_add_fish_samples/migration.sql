-- CreateTable
CREATE TABLE "FishSample" (
    "id" TEXT NOT NULL,
    "biomassLogId" TEXT NOT NULL,
    "weightGrams" DOUBLE PRECISION NOT NULL,
    "lengthCm" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "FishSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FishSample_biomassLogId_idx" ON "FishSample"("biomassLogId");

-- AddForeignKey
ALTER TABLE "FishSample" ADD CONSTRAINT "FishSample_biomassLogId_fkey" FOREIGN KEY ("biomassLogId") REFERENCES "BiomassLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
