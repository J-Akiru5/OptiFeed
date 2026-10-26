-- Audit remediation (#23): additive composite indexes.
--
-- FcrReport is read with `orderBy: { periodEnd: "desc" }` on a pond in the
-- growth page, dashboard, chat context, growth plan, prediction route and
-- exports. The existing (pondId, periodStart) index does not cover that sort.
--
-- ScheduleCommand is read with `where: { deviceId, status }` and
-- `orderBy: { appliedAt: "desc" }` when resolving the current schedule.
--
-- Additive only: no columns, constraints or rows are changed.

CREATE INDEX "FcrReport_pondId_periodEnd_idx" ON "FcrReport"("pondId", "periodEnd");

CREATE INDEX "ScheduleCommand_deviceId_appliedAt_idx" ON "ScheduleCommand"("deviceId", "appliedAt");
