-- AlterTable
ALTER TABLE "AiProviderConfig" ADD COLUMN     "baseUrl" TEXT,
ADD COLUMN     "keyCiphertext" BYTEA,
ADD COLUMN     "keyIv" BYTEA,
ADD COLUMN     "keyLast4" TEXT,
ADD COLUMN     "keyTag" BYTEA,
ADD COLUMN     "keyUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "keyUpdatedBy" TEXT,
ADD COLUMN     "keyVersion" INTEGER,
ADD COLUMN     "kind" TEXT,
ADD COLUMN     "label" TEXT;
