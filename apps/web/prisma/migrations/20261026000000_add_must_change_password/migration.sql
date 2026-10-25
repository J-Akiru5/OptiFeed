-- Existing accounts still have numeric PINs. Force them to set a permanent
-- password on their next login. New rows default to false and are set
-- explicitly by the account-creation paths.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" SET "mustChangePassword" = true;
