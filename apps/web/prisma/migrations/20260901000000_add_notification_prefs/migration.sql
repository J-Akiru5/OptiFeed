-- AlterTable
ALTER TABLE "Pond" ADD COLUMN "notificationPrefs" JSONB NOT NULL DEFAULT '{"missedFeeding":true,"deviceOffline":true,"hopperLow":true}';
