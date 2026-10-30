import { ScheduleControls } from "@/components/ScheduleControls";
import { ScheduleEditor } from "@/components/ScheduleEditor";
import { StuckRequestBanner } from "@/components/StuckRequestBanner";
import { TimeCalibrationForm } from "@/components/TimeCalibrationForm";
import {
	DashboardEmptyState,
	DashboardPageHeader,
	DashboardPageShell,
	ReadOnlyNotice,
} from "@/components/dashboard/dashboard-ui";
import { SnapshotWriter } from "@/components/pwa/snapshot-writer";
import { canWrite } from "@/lib/auth/session";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { getFeedNowLimitForDevice } from "@/lib/feed/feed-now-limit";
import type { ScheduleSnapshotData } from "@/lib/offline/snapshots";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { CalendarClock } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

const STALE_THRESHOLD_MS = 10 * 60 * 1000;

function fmtTime(date: Date): string {
	return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export default async function SchedulePage() {
	const [t, tCommon] = await Promise.all([
		getTranslations("dashboard.schedule"),
		getTranslations("dashboard.common"),
	]);
	const pond = await getActivePond();

	if (!pond) {
		return (
			<div className="mx-auto max-w-2xl py-10">
				<DashboardEmptyState
					icon={CalendarClock}
					title={t("noPondData")}
					description={t("noDeviceDesc")}
				/>
			</div>
		);
	}

	const energyDevice = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			label: true,
			lastSeenAt: true,
			isPaused: true,
			gramsPerFeeding: true,
			gramsPerSecond: true,
			dailyCapG: true,
			hopperCapacityG: true,
		},
	});

	if (!energyDevice) {
		return (
			<div className="mx-auto max-w-2xl py-10">
				<DashboardEmptyState
					icon={CalendarClock}
					title={t("noDeviceTitle")}
					description={t("noDeviceDesc")}
				/>
			</div>
		);
	}

	// The Feed Now ceiling (issue #387): pond per-meal dose, remaining daily
	// allowance and the absolute hard ceiling, whichever is lowest.
	const feedNowLimit = await getFeedNowLimitForDevice(energyDevice);

	const [latestAppliedCommand, pendingCommands, stuckFeedRequests, stuckScheduleCommands] =
		await Promise.all([
			prisma.scheduleCommand.findFirst({
				where: { deviceId: energyDevice.id, status: "applied" },
				orderBy: { appliedAt: "desc" },
			}),
			prisma.scheduleCommand.findMany({
				where: { deviceId: energyDevice.id, status: { in: ["pending", "sent"] } },
				orderBy: { createdAt: "desc" },
				take: 1,
			}),
			// Stuck dispatched feed requests — picked up by device but never confirmed
			prisma.feedRequest.findMany({
				where: {
					deviceId: energyDevice.id,
					status: "dispatched",
					updatedAt: { lt: new Date(Date.now() - STALE_THRESHOLD_MS) },
				},
				orderBy: { createdAt: "asc" },
				take: 10,
				select: { id: true, grams: true, createdAt: true },
			}),
			// Stuck sent schedule commands — picked up by device but never acked
			prisma.scheduleCommand.findMany({
				where: {
					deviceId: energyDevice.id,
					status: "sent",
					updatedAt: { lt: new Date(Date.now() - STALE_THRESHOLD_MS) },
				},
				orderBy: { createdAt: "asc" },
				take: 5,
				select: { id: true, createdAt: true },
			}),
		]);

	const pendingCommand = pendingCommands.length > 0 ? pendingCommands[0] : null;

	const deviceOffline =
		!energyDevice.lastSeenAt ||
		Date.now() - energyDevice.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS;

	const serializeCommand = (cmd: typeof latestAppliedCommand) => {
		if (!cmd) return null;
		return {
			id: cmd.id,
			status: cmd.status,
			scheduleStart: fmtTime(cmd.scheduleStart),
			scheduleEnd: fmtTime(cmd.scheduleEnd),
			feedsPerDay: cmd.feedsPerDay,
			feedingRatePct: cmd.feedingRatePct,
			appliedAt: cmd.appliedAt?.toISOString() ?? null,
			deviceTime: cmd.deviceTime,
		};
	};

	// `pond.*` only reflects the current config when no EnergyDevice is paired;
	// otherwise the newest pending/sent command wins, then the last applied one.
	const currentCommand = serializeCommand(pendingCommand ?? latestAppliedCommand);
	const writeAccess = await canWrite();

	const scheduleSnapshot: ScheduleSnapshotData = {
		pondName: pond.name,
		deviceName: energyDevice.label ?? "Feeder",
		deviceStatus: deviceOffline ? "offline" : "online",
		lastSeenAt: energyDevice.lastSeenAt?.toISOString() ?? null,
		scheduleStart: currentCommand?.scheduleStart ?? fmtTime(pond.scheduleStart),
		scheduleEnd: currentCommand?.scheduleEnd ?? fmtTime(pond.scheduleEnd),
		feedsPerDay: currentCommand?.feedsPerDay ?? pond.feedsPerDay,
		feedingRatePct: currentCommand?.feedingRatePct ?? pond.feedingRatePct,
		gramsPerFeeding: energyDevice.gramsPerFeeding,
		isPaused: energyDevice.isPaused,
		pendingCommandStatus: pendingCommand?.status ?? null,
		pendingCommandAt: pendingCommand?.createdAt?.toISOString() ?? null,
	};

	return (
		<DashboardPageShell className="space-y-8">
			<SnapshotWriter
				page="schedule"
				scope={pond.ownerId}
				pondId={pond.id}
				pondName={pond.name}
				data={scheduleSnapshot}
			/>
			<DashboardPageHeader icon={CalendarClock} title={t("title")} description={t("desc")} />

			{!writeAccess && (
				<ReadOnlyNotice title={tCommon("readOnlyTitle")} description={tCommon("readOnlyDesc")} />
			)}

			{/* Below `xl` this is one column in the order farmers already had:
			    time calibration, device notices, feed controls, then the editor.
			    From `xl` the notices and controls move into a sticky rail and the
			    editor keeps the wide column (#247). The `contents` wrappers let
			    the same DOM serve both layouts, with `order-*` restoring the
			    mobile order (same pattern as the dashboard control room). */}
			<div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
				<div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-6">
					<div className="order-1 xl:order-none">
						<TimeCalibrationForm deviceId={energyDevice.id} canWrite={writeAccess} />
					</div>
					<div className="order-4 xl:order-none">
						<ScheduleEditor
							pondId={pond.id}
							deviceId={energyDevice.id}
							initialStart={currentCommand?.scheduleStart ?? fmtTime(pond.scheduleStart)}
							initialEnd={currentCommand?.scheduleEnd ?? fmtTime(pond.scheduleEnd)}
							initialFeedsPerDay={currentCommand?.feedsPerDay ?? pond.feedsPerDay}
							initialFeedingRatePct={currentCommand?.feedingRatePct ?? pond.feedingRatePct}
							pendingCommand={serializeCommand(pendingCommand)}
							latestAppliedCommand={serializeCommand(latestAppliedCommand)}
							canWrite={writeAccess}
						/>
					</div>
				</div>

				<aside
					aria-label={t("controlsLabel")}
					className="contents xl:sticky xl:top-24 xl:flex xl:min-w-0 xl:flex-col xl:gap-4"
				>
					<div className="order-2 empty:hidden xl:order-none">
						<StuckRequestBanner
							stuckFeedRequests={stuckFeedRequests.map((r) => ({
								id: r.id,
								grams: r.grams,
								createdAt: r.createdAt.toISOString(),
							}))}
							stuckScheduleCommands={stuckScheduleCommands.map((c) => ({
								id: c.id,
								createdAt: c.createdAt.toISOString(),
							}))}
							deviceOffline={deviceOffline}
							deviceLastSeenAt={energyDevice.lastSeenAt?.toISOString() ?? null}
							deviceId={energyDevice.id}
							pondId={pond.id}
							scheduleStart={currentCommand?.scheduleStart ?? fmtTime(pond.scheduleStart)}
							scheduleEnd={currentCommand?.scheduleEnd ?? fmtTime(pond.scheduleEnd)}
							feedsPerDay={currentCommand?.feedsPerDay ?? pond.feedsPerDay}
							feedingRatePct={currentCommand?.feedingRatePct ?? pond.feedingRatePct}
							canWrite={writeAccess}
						/>
					</div>
					<div className="order-3 xl:order-none">
						<ScheduleControls
							deviceId={energyDevice.id}
							initialIsPaused={energyDevice.isPaused}
							gramsPerFeeding={energyDevice.gramsPerFeeding}
							gramsPerSecond={energyDevice.gramsPerSecond}
							canWrite={writeAccess}
							feedNowLimit={feedNowLimit}
						/>
					</div>
				</aside>
			</div>
		</DashboardPageShell>
	);
}
