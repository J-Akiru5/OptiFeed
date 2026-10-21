-- Pond lifecycle status (EMS asset-state analog):
--   ACTIVE   — normal working pond (appears in selector, dashboard, actions)
--   ARCHIVED — retained with all history, hidden from farmer-facing flows;
--              still visible to admins.

CREATE TYPE "PondStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

ALTER TABLE "Pond" ADD COLUMN "status" "PondStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "Pond_status_idx" ON "Pond"("status");
