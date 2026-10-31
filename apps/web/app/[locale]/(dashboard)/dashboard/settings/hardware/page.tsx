import { DeviceDailyCapForm } from "@/components/DeviceDailyCapForm";
import { DurationCalibrationForm } from "@/components/DurationCalibrationForm";
import { HopperCalibrationForm } from "@/components/HopperCalibrationForm";
import { TemperatureCalibrationForm } from "@/components/TemperatureCalibrationForm";
import {
	CalibrationHistory,
	type CalibrationHistoryRow,
} from "@/components/calibration/CalibrationHistory";
import { RecalibrationIntervalForm } from "@/components/calibration/RecalibrationIntervalForm";
import {
	DashboardEmptyState,
	DashboardPageHeader,
	DashboardSection,
	ReadOnlyNotice,
} from "@/components/dashboard/dashboard-ui";
import { DeviceSignalReading } from "@/components/device-signal";
import { FeedLevelDisplay } from "@/components/feed-level-display";
import { FeederViewerLazy } from "@/components/feeder/feeder-viewer-lazy";
import { HealthNotice } from "@/components/feeder/health-notice";
import {
	DeviceSettingsTabs,
	type DeviceSwitcherOption,
} from "@/components/settings/device-settings-tabs";
import { updateDeviceDailyCap } from "@/lib/actions/settings";
import { canWrite } from "@/lib/auth/session";
import { computeCalibrationDrift } from "@/lib/calibration/drift";
import { loadCalibrationDriftWindow } from "@/lib/calibration/drift-data";
import { getRecalibrationStatus } from "@/lib/calibration/recalibration";
import { DEVICE_COMMAND_IN_FLIGHT_MS } from "@/lib/constants";
import { formatFarmDateTime } from "@/lib/date-local";
import { toHopperSnapshot } from "@/lib/device-hopper";
import { evaluateDeviceStatus, resolveRssiDbm } from "@/lib/device-status";
import { type FeederHeroPond, loadFeederHero } from "@/lib/feeder-hero";
import { getPageCount, parsePage } from "@/lib/pagination";
import { getActivePondId, listSelectablePonds } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { AP_PREFIX } from "@/lib/provisioning-ap";
import {
	deviceSettingsQuery,
	parseDeviceSettingsTab,
	resolveSelectedDevice,
} from "@/lib/settings/device-settings-tabs";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
import {
	Activity,
	CalendarClock,
	Cpu,
	Gauge,
	History,
	RefreshCw,
	Ruler,
	Settings,
	Thermometer,
	Timer,
	Wifi,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

// The setup panel is stricter than the 15-minute offline threshold: "WiFi is
// configured" is only claimed while the device is actively reporting.
const WIFI_ONLINE_WINDOW_MS = 5 * 60 * 1000;

const CALIBRATION_HISTORY_PAGE_SIZE = 20;

function first(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

/**
 * The most recent queued/dispatched dose, used only to keep #388 from showing
 * "offline" while a calibration or manual command is being delivered. The read
 * is best-effort: a failure here must not break the hardware page.
 */
async function loadActiveFeedRequest(deviceId: string): Promise<{ updatedAt: Date } | null> {
	try {
		return await prisma.feedRequest.findFirst({
			where: { deviceId, status: { in: ["pending", "dispatched"] } },
			orderBy: { updatedAt: "desc" },
			select: { updatedAt: true },
		});
	} catch {
		return null;
	}
}

function formatGrams(grams: number): string {
	return `${String(Number(grams.toFixed(1)))} g`;
}

// The firmware names its setup SoftAP `<AP_PREFIX>XXXX` using the last four hex
// digits of the device MAC (see docs/wifi-provisioning-plan.md). The prefix is
// shared with the firmware and the admin sticker via lib/provisioning-ap.ts.
function getSetupApName(mac: string | null | undefined): string | null {
	if (!mac) return null;
	const hex = mac.toUpperCase().replace(/[^0-9A-F]/g, "");
	return hex.length >= 4 ? `${AP_PREFIX}${hex.slice(-4)}` : null;
}

/**
 * Recent calibration sessions (max 10) with the number of attempts and the
 * error from the last attempt. `_count` keeps the count exact even when the
 * table is paginated, and `_max` orders the newest sitting first.
 */
async function loadCalibrationSessions(deviceId: string) {
	const groups = await prisma.calibrationRun.groupBy({
		by: ["sessionId"],
		where: { deviceId },
		_count: { _all: true },
		_max: { createdAt: true },
		orderBy: { _max: { createdAt: "desc" } },
		take: 10,
	});
	if (groups.length === 0) return [];

	const sessionIds = groups.map((group) => group.sessionId);
	// Bounded: ten sessions' efforts always fit well inside this, and the rows
	// are newest-first, so the last attempt of every session stays in range. The
	// list is only used to name the error of the final attempt per session.
	const runs = await prisma.calibrationRun.findMany({
		where: { deviceId, sessionId: { in: sessionIds } },
		orderBy: { createdAt: "desc" },
		take: 500,
		select: { sessionId: true, errorPct: true },
	});

	const finalErrorBySession = new Map<string, number | null>();
	for (const run of runs) {
		if (!finalErrorBySession.has(run.sessionId)) {
			finalErrorBySession.set(run.sessionId, run.errorPct);
		}
	}

	return groups.map((group) => ({
		sessionId: group.sessionId,
		attempts: group._count._all,
		finalErrorPct: finalErrorBySession.get(group.sessionId) ?? null,
		lastAt: group._max.createdAt ?? new Date(0),
	}));
}

interface HardwareSettingsPageProps {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HardwareSettingsPage({ searchParams }: HardwareSettingsPageProps) {
	const [t, tCommon, tDates] = await Promise.all([
		getTranslations("dashboard.appSettings"),
		getTranslations("dashboard.common"),
		getTranslations("dates"),
	]);
	const writeAccess = await canWrite();
	const rawParams = await searchParams;
	let historyPage = parsePage(first(rawParams.page));
	const activeTab = parseDeviceSettingsTab(first(rawParams.tab));
	const now = new Date();
	const statusPolicy = await getDeviceStatusPolicy();
	let energyDevice = null;
	let pondIsFallow = false;
	let pondName: string | null = null;
	let heroPond: FeederHeroPond | null = null;
	let switcherOptions: DeviceSwitcherOption[] = [];
	try {
		// #403: every feeder on the caller's ACTIVE ponds can be configured here,
		// chosen with `?device=`. The list is owner-scoped, so a foreign or stale
		// id simply does not match and the active pond's first feeder wins.
		const [ponds, activePondCookie] = await Promise.all([listSelectablePonds(), getActivePondId()]);
		const activePondId = ponds.some((p) => p.id === activePondCookie)
			? activePondCookie
			: (ponds[0]?.id ?? null);
		const devices =
			ponds.length > 0
				? await prisma.energyDevice.findMany({
						where: { pondId: { in: ponds.map((p) => p.id) } },
						orderBy: { createdAt: "asc" },
						select: {
							id: true,
							label: true,
							pondId: true,
							lastSeenAt: true,
							wifiRssiDbm: true,
							wifiRssiUpdatedAt: true,
						},
					})
				: [];
		const pondNameById = new Map(ponds.map((p) => [p.id, p.name]));
		switcherOptions = devices.map((device) => {
			const status = evaluateDeviceStatus({
				lastSeenAt: device.lastSeenAt,
				now,
				policy: statusPolicy,
				rssiDbm: resolveRssiDbm({
					rssiDbm: device.wifiRssiDbm,
					updatedAt: device.wifiRssiUpdatedAt,
					now,
					policy: statusPolicy,
				}),
			});
			return {
				id: device.id,
				label: device.label,
				pondName: (device.pondId && pondNameById.get(device.pondId)) || "",
				state: status.isOffline ? "offline" : status.isWeak ? "weak" : "online",
			};
		});

		const selected = resolveSelectedDevice(devices, first(rawParams.device), activePondId);
		const pond = ponds.find((p) => p.id === (selected?.pondId ?? activePondId));
		if (pond) {
			pondIsFallow = Boolean(pond.isFallow);
			pondName = pond.name;
			heroPond = {
				id: pond.id,
				isFallow: Boolean(pond.isFallow),
				population: typeof pond.population === "number" ? pond.population : null,
				feedingRatePct: Number(pond.feedingRatePct),
				feedsPerDay: Number(pond.feedsPerDay),
				scheduleStart: pond.scheduleStart,
				scheduleEnd: pond.scheduleEnd,
			};
		}
		if (selected) {
			energyDevice = await prisma.energyDevice.findUnique({
				where: { id: selected.id },
				select: {
					id: true,
					mac: true,
					label: true,
					lastSeenAt: true,
					feedLevelPercent: true,
					feedLevelUpdatedAt: true,
					hopperFullCm: true,
					hopperEmptyCm: true,
					hopperCapacityG: true,
					hopperDiameterCm: true,
					hopperBulkDensityGCm3: true,
					gramsPerSecond: true,
					gramsPerFeeding: true,
					dailyCapG: true,
					lastCalibratedAt: true,
					recalibrationIntervalDays: true,
					tempOffsetC: true,
					waterTempC: true,
					wifiRssiDbm: true,
					wifiRssiUpdatedAt: true,
				},
			});
		}
	} catch (err) {
		console.error("[HardwareSettingsPage] Prisma error:", err);
	}

	const activeFeedRequest = energyDevice ? await loadActiveFeedRequest(energyDevice.id) : null;
	// #388: a dose being delivered keeps the status out of offline. Only a recent
	// request counts; an abandoned pending row must not mask a silent device.
	const commandInFlight =
		!!activeFeedRequest &&
		now.getTime() - activeFeedRequest.updatedAt.getTime() <= DEVICE_COMMAND_IN_FLIGHT_MS;
	const rssiDbm = resolveRssiDbm({
		rssiDbm: energyDevice?.wifiRssiDbm ?? null,
		updatedAt: energyDevice?.wifiRssiUpdatedAt ?? null,
		now,
		policy: statusPolicy,
	});
	const connection = evaluateDeviceStatus({
		lastSeenAt: energyDevice?.lastSeenAt ?? null,
		now,
		policy: statusPolicy,
		rssiDbm,
		inFlight: commandInFlight,
	});
	const hopper = energyDevice ? toHopperSnapshot(energyDevice, now, statusPolicy) : null;

	// The hero reads its own bounded slice (daily grams, effective schedule,
	// reported firmware, the deterministic advisor) for the device the page has
	// already resolved through the guarded active-pond lookup.
	const feederHero =
		energyDevice && heroPond && pondName
			? await loadFeederHero({ pond: heroPond, deviceId: energyDevice.id, now })
			: null;

	// Calibration history, session summaries and the rule-based drift check.
	// Every query is scoped to the active pond's device.
	let historyRows: CalibrationHistoryRow[] = [];
	let historyTotal = 0;
	let historySessions: Awaited<ReturnType<typeof loadCalibrationSessions>> = [];
	let drift = computeCalibrationDrift({
		feeds: [],
		levels: [],
		hopperCapacityG: null,
	});

	if (energyDevice) {
		historyTotal = await prisma.calibrationRun.count({
			where: { deviceId: energyDevice.id },
		});
		const pagesForDevice = getPageCount(historyTotal, CALIBRATION_HISTORY_PAGE_SIZE);
		if (historyPage > pagesForDevice) historyPage = pagesForDevice;

		const [runs, sessions, driftWindow] = await Promise.all([
			prisma.calibrationRun.findMany({
				where: { deviceId: energyDevice.id },
				orderBy: { createdAt: "desc" },
				skip: (historyPage - 1) * CALIBRATION_HISTORY_PAGE_SIZE,
				take: CALIBRATION_HISTORY_PAGE_SIZE,
				select: {
					id: true,
					createdAt: true,
					kind: true,
					attempt: true,
					targetGrams: true,
					measuredGrams: true,
					errorPct: true,
					gramsPerSecondBefore: true,
					gramsPerSecondAfter: true,
					accepted: true,
					createdById: true,
				},
			}),
			loadCalibrationSessions(energyDevice.id),
			// One loader for every drift surface (#6): the hardware page used to
			// compare imported hand_fed daily totals with the hopper drop.
			loadCalibrationDriftWindow(energyDevice.id, now),
		]);

		historySessions = sessions;
		const creatorIds = [
			...new Set(runs.map((run) => run.createdById).filter((id): id is string => Boolean(id))),
		];
		const creators =
			creatorIds.length > 0
				? await prisma.user.findMany({
						where: { id: { in: creatorIds } },
						select: { id: true, displayName: true, email: true },
					})
				: [];
		const creatorNameById = new Map(
			creators.map((creator) => [creator.id, creator.displayName || creator.email]),
		);

		historyRows = runs.map((run) => ({
			id: run.id,
			createdAt: run.createdAt,
			kind: run.kind,
			attempt: run.attempt,
			targetGrams: run.targetGrams,
			measuredGrams: run.measuredGrams,
			errorPct: run.errorPct,
			gramsPerSecondBefore: run.gramsPerSecondBefore,
			gramsPerSecondAfter: run.gramsPerSecondAfter,
			accepted: run.accepted,
			createdByName: run.createdById ? (creatorNameById.get(run.createdById) ?? null) : null,
		}));

		drift = computeCalibrationDrift({
			feeds: driftWindow.feeds,
			levels: driftWindow.levels,
			hopperCapacityG: energyDevice.hopperCapacityG,
		});
	}

	const recalibration = getRecalibrationStatus(
		energyDevice?.lastCalibratedAt ?? null,
		energyDevice?.recalibrationIntervalDays ?? 30,
		now,
	);
	const historyPageCount = getPageCount(historyTotal, CALIBRATION_HISTORY_PAGE_SIZE);
	const dueLabel = recalibration.dueAt
		? formatFarmDateTime(recalibration.dueAt, tDates).fullDate
		: null;

	const isDeviceOffline = connection.isOffline;
	const hopperOffline = hopper?.isOffline ?? isDeviceOffline;
	const isWifiConfigured =
		!!energyDevice?.lastSeenAt &&
		now.getTime() - energyDevice.lastSeenAt.getTime() <= WIFI_ONLINE_WINDOW_MS;
	const setupApName = getSetupApName(energyDevice?.mac);

	function formatOfflineDuration(lastSeenAt: Date): string {
		const totalMinutes = Math.floor((now.getTime() - lastSeenAt.getTime()) / 60000);
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		if (hours > 0) return t("durationHoursMinutes", { hours, minutes });
		return t("durationMinutes", { minutes });
	}

	const connectionLabel = isDeviceOffline
		? energyDevice?.lastSeenAt
			? t("offlineFor", { duration: formatOfflineDuration(energyDevice.lastSeenAt) })
			: t("offline")
		: connection.isWeak
			? energyDevice?.lastSeenAt
				? t("weakFor", { duration: formatOfflineDuration(energyDevice.lastSeenAt) })
				: t("weakSignal")
			: t("online");

	const statLabel = "text-xs font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400";
	const statTile = "rounded-xl bg-[#F4F7F6] p-4 dark:bg-gray-800/60";
	const statValue = "mt-1 text-sm font-bold text-[#0A3D62] dark:text-gray-100";

	const noDeviceState = (
		<DashboardEmptyState icon={Cpu} title={t("noDevice")} description={t("noDeviceDesc")} />
	);

	return (
		<div className="w-full space-y-6 pb-20">
			<DashboardPageHeader title={t("title")} description={t("desc")} icon={Settings} />

			{!writeAccess && (
				<ReadOnlyNotice title={tCommon("readOnlyTitle")} description={tCommon("readOnlyDesc")} />
			)}

			<DeviceSettingsTabs
				initialTab={activeTab}
				deviceId={energyDevice?.id ?? null}
				devices={switcherOptions}
				panels={{
					overview: (
						<>
							{feederHero && <HealthNotice health={feederHero.health} tone="themed" />}
							{feederHero && pondName && energyDevice && (
								<FeederViewerLazy
									deviceId={energyDevice.id}
									label={feederHero.deviceLabel}
									initialStatus={
										feederHero.connectionState === "offline"
											? "offline"
											: feederHero.connectionState === "weak"
												? "weak"
												: feederHero.isPaused
													? "paused"
													: "idle"
									}
									initialLevel={feederHero.hopperLevelPercent}
									initialLastFedAt={null}
								/>
							)}

							{/* Device Status */}
							<DashboardSection
								id="device-status"
								title={t("deviceStatus")}
								description={t("deviceStatusDesc")}
								icon={Cpu}
							>
								{energyDevice ? (
									<dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
										<div className={statTile}>
											<dt className={statLabel}>{t("wifiSetup.deviceId")}</dt>
											<dd className={`${statValue} break-all font-mono`}>
												{energyDevice.mac}
												<span className="mt-1 block font-mono text-[10px] font-medium text-[#3D5568] dark:text-gray-500">
													{t("supportId", { id: energyDevice.id })}
												</span>
											</dd>
										</div>
										<div className={statTile}>
											<dt className={statLabel}>{t("connectionStatus")}</dt>
											<dd
												className={`mt-1 text-sm font-bold ${
													isDeviceOffline
														? "text-[#C42B3A] dark:text-red-300"
														: connection.isWeak
															? "text-[#9A3412] dark:text-amber-300"
															: "text-[#1E7B34] dark:text-green-300"
												}`}
											>
												{connectionLabel}
												<DeviceSignalReading
													rssiDbm={rssiDbm}
													className="mt-1 block text-xs font-bold text-[#3D5568] dark:text-gray-400"
												/>
											</dd>
										</div>
										<div className={statTile}>
											<dt className={statLabel}>{t("hopperLevel")}</dt>
											<dd className={statValue}>
												<FeedLevelDisplay
													levelPercent={hopper?.levelPercent ?? null}
													updatedAt={hopper?.levelUpdatedAt ?? null}
													isOffline={hopperOffline}
													showBar={false}
												/>
											</dd>
										</div>
										<div className={statTile}>
											<dt className={statLabel}>{t("firmware")}</dt>
											<dd className={`${statValue} font-mono`}>
												{feederHero?.firmwareVersion ? `v${feederHero.firmwareVersion}` : "—"}
											</dd>
										</div>
									</dl>
								) : (
									<DashboardEmptyState
										icon={Cpu}
										title={t("noDevice")}
										description={t("noDeviceDesc")}
									/>
								)}
							</DashboardSection>

							{/* Device Actions */}
							<DashboardSection
								title={t("deviceActions")}
								description={t("deviceActionsDesc")}
								icon={RefreshCw}
							>
								<p
									id="device-actions-unavailable"
									className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300"
								>
									{t("actionsUnavailable")}
								</p>

								<div className="space-y-3">
									<button
										type="button"
										disabled
										aria-describedby="device-actions-unavailable"
										className="flex min-h-11 w-full cursor-not-allowed items-center justify-between rounded-xl border border-[#0A3D62]/10 bg-white px-4 font-bold text-[#0A3D62] opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
									>
										<span className="flex items-center gap-3">
											<RefreshCw aria-hidden="true" className="h-5 w-5 text-[#E85A2A]" />
											{t("syncNow")}
										</span>
									</button>
									<button
										type="button"
										disabled
										aria-describedby="device-actions-unavailable"
										className="flex min-h-11 w-full cursor-not-allowed items-center justify-between rounded-xl border border-red-100 bg-red-50 px-4 font-bold text-[#C42B3A] opacity-50 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
									>
										<span className="flex items-center gap-3">
											<Cpu aria-hidden="true" className="h-5 w-5" />
											{t("restartDevice")}
										</span>
									</button>
								</div>
							</DashboardSection>
						</>
					),
					feeding: (
						<>
							{!energyDevice && noDeviceState}
							{/* Daily feed ceiling */}
							{energyDevice && (
								<DashboardSection
									id="daily-ceiling"
									title={t("dailyCeiling")}
									description={t("dailyCeilingDesc")}
									icon={Gauge}
								>
									<DeviceDailyCapForm
										deviceId={energyDevice.id}
										currentCapG={energyDevice.dailyCapG}
										saveAction={updateDeviceDailyCap}
										canWrite={writeAccess}
									/>
								</DashboardSection>
							)}
						</>
					),
					calibration: (
						<>
							{!energyDevice && noDeviceState}
							{/* Hopper Calibration */}
							{energyDevice && (
								<DashboardSection
									id="hopper-calibration"
									title={t("hopperCalibration")}
									description={t("hopperCalibrationDesc")}
									icon={Ruler}
								>
									<div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-900/20">
										<p className="text-xs font-medium text-blue-800 dark:text-blue-200">
											{t("currentLevelLabel")}
										</p>
										<FeedLevelDisplay
											levelPercent={hopper?.levelPercent ?? null}
											updatedAt={hopper?.levelUpdatedAt ?? null}
											isOffline={hopperOffline}
											showBar={false}
										/>
									</div>

									<HopperCalibrationForm
										deviceId={energyDevice.id}
										hopperFullCm={energyDevice.hopperFullCm}
										hopperEmptyCm={energyDevice.hopperEmptyCm}
										hopperCapacityG={energyDevice.hopperCapacityG}
										hopperDiameterCm={energyDevice.hopperDiameterCm}
										hopperBulkDensityGCm3={energyDevice.hopperBulkDensityGCm3}
										canWrite={writeAccess}
									/>
								</DashboardSection>
							)}

							{/* Duration Calibration */}
							{energyDevice && (
								<DashboardSection
									id="calibration"
									title={t("calibration.title")}
									description={t("calibration.desc")}
									icon={Timer}
								>
									<DurationCalibrationForm
										deviceId={energyDevice.id}
										currentGramsPerSecond={energyDevice.gramsPerSecond}
										currentGramsPerFeeding={energyDevice.gramsPerFeeding}
										canWrite={writeAccess}
										isOffline={isDeviceOffline}
										isFallow={pondIsFallow}
									/>
								</DashboardSection>
							)}

							{/* Recalibration schedule + drift detector */}
							{energyDevice && (
								<DashboardSection
									id="recalibration"
									title={t("calibration.recalibration.title")}
									description={t("calibration.recalibration.desc")}
									icon={CalendarClock}
								>
									{recalibration.isOverdue && dueLabel && (
										<output className="mb-4 block rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
											<p className="text-sm font-bold text-amber-800 dark:text-amber-300">
												{t("calibration.recalibration.overdueTitle")}
											</p>
											<p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
												{t("calibration.recalibration.overdueDesc", {
													days: recalibration.daysOverdue,
													due: dueLabel,
												})}
											</p>
										</output>
									)}
									{!recalibration.isOverdue && dueLabel && (
										<p className="mb-4 text-xs font-medium text-gray-600 dark:text-gray-400">
											{t("calibration.recalibration.nextDue", { due: dueLabel })}
										</p>
									)}
									{!dueLabel && (
										<p className="mb-4 text-xs font-medium text-gray-600 dark:text-gray-400">
											{t("calibration.recalibration.never")}
										</p>
									)}

									<RecalibrationIntervalForm
										deviceId={energyDevice.id}
										currentIntervalDays={energyDevice.recalibrationIntervalDays}
										canWrite={writeAccess}
									/>

									{drift.status === "drift" && drift.diffPct !== null && (
										<div
											role="alert"
											className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20"
										>
											<p className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-300">
												<Activity className="h-4 w-4 shrink-0" aria-hidden="true" />
												{t("calibration.drift.title")}
											</p>
											<p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
												{t("calibration.drift.desc", {
													dispensed: formatGrams(drift.dispensedG),
													observed: formatGrams(drift.observedG),
													diff: `${drift.diffPct >= 0 ? "+" : ""}${drift.diffPct.toFixed(1)}%`,
												})}
											</p>
										</div>
									)}
								</DashboardSection>
							)}

							{/* Temperature sensor calibration */}
							{energyDevice && (
								<DashboardSection
									id="temperature-calibration"
									title={t("temperatureCalibration")}
									description={t("temperatureCalibrationDesc")}
									icon={Thermometer}
								>
									<div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-900/50 dark:bg-sky-900/20">
										<p className="text-xs font-medium text-sky-800 dark:text-sky-200">
											{t("currentOffset")}:{" "}
											<strong>
												{energyDevice.tempOffsetC >= 0 ? "+" : ""}
												{energyDevice.tempOffsetC}°C
											</strong>
											{energyDevice.waterTempC !== null && (
												<>
													{" · "}
													{t("lastReading")}:{" "}
													<strong>{energyDevice.waterTempC.toFixed(1)}°C</strong>
												</>
											)}
										</p>
									</div>

									<div data-help="setting-temperature-calibration">
										<TemperatureCalibrationForm
											deviceId={energyDevice.id}
											currentTempOffsetC={energyDevice.tempOffsetC}
											currentTempC={energyDevice.waterTempC}
											canWrite={writeAccess}
										/>
									</div>
								</DashboardSection>
							)}

							{/* Calibration history */}
							{energyDevice && (
								<DashboardSection
									id="calibration-history"
									title={t("calibration.history.title")}
									description={t("calibration.history.desc")}
									icon={History}
								>
									<CalibrationHistory
										rows={historyRows}
										sessions={historySessions}
										total={historyTotal}
										page={historyPage}
										pageCount={historyPageCount}
										pageSize={CALIBRATION_HISTORY_PAGE_SIZE}
										paginationParams={deviceSettingsQuery({
											deviceId: energyDevice.id,
											tab: "calibration",
										})}
									/>
								</DashboardSection>
							)}
						</>
					),
					network: (
						<>
							{/* WiFi Setup */}
							<DashboardSection
								id="wifi-setup"
								title={t("wifiSetup.title")}
								description={t("wifiSetup.desc")}
								icon={Wifi}
							>
								<div className="rounded-xl bg-[#F4F7F6] p-4 dark:bg-gray-800/60">
									<div className="flex flex-wrap items-start justify-between gap-4">
										<div className="min-w-0">
											<p className={statLabel}>{t("wifiSetup.apName")}</p>
											{setupApName ? (
												<p className="mt-1 break-all font-mono text-lg font-bold text-[#0A3D62] dark:text-gray-100">
													{setupApName}
												</p>
											) : (
												<p className="mt-1 text-sm font-medium text-[#3D5568] dark:text-gray-300">
													{energyDevice ? t("wifiSetup.apUnknown") : t("wifiSetup.noDevice")}
												</p>
											)}
											{energyDevice && (
												<p className="mt-1 text-xs text-[#3D5568] dark:text-gray-400">
													{energyDevice.label}
												</p>
											)}
										</div>
										{energyDevice && (
											<div className="min-w-0">
												<p className={statLabel}>{t("wifiSetup.deviceId")}</p>
												<p className="mt-1 break-all font-mono text-lg font-bold text-[#0A3D62] dark:text-gray-100">
													{energyDevice.mac}
												</p>
												<p className="mt-1 text-xs text-[#3D5568] dark:text-gray-400">
													{t("wifiSetup.deviceIdHint")}
												</p>
											</div>
										)}
									</div>
								</div>

								{energyDevice &&
									(isWifiConfigured ? (
										<div className="mt-4 space-y-1 rounded-xl border border-[#1E7B34]/20 bg-[#1E7B34]/5 p-4 dark:border-green-900/50 dark:bg-green-900/20">
											<p className="text-sm font-bold text-[#1E7B34] dark:text-green-300">
												{t("wifiSetup.connected")}
											</p>
											<p className="text-xs text-[#3D5568] dark:text-gray-300">
												{t("wifiSetup.apOff")}
											</p>
										</div>
									) : (
										<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/20">
											<p className="text-xs font-medium text-amber-800 dark:text-amber-300">
												{t("wifiSetup.needsSetup")}
											</p>
										</div>
									))}

								{energyDevice && (
									<div className="mt-6">
										<p className="text-sm font-bold text-[#0A3D62] dark:text-gray-200">
											{t("wifiSetup.steps")}
										</p>
										<ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[#3D5568] dark:text-gray-300">
											<li>{t("wifiSetup.step1")}</li>
											<li>{t("wifiSetup.step2")}</li>
											<li>{t("wifiSetup.step3")}</li>
											<li>{t("wifiSetup.step4")}</li>
											<li>{t("wifiSetup.step5")}</li>
										</ol>
										<p className="mt-3 text-xs text-[#3D5568] dark:text-gray-400">
											{t("wifiSetup.credentialsNote")}
										</p>
										<p className="mt-1 text-xs text-[#3D5568] dark:text-gray-400">
											{t("wifiSetup.tokenWarning")}
										</p>
									</div>
								)}

								{energyDevice && !isWifiConfigured && (
									<div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
										<p className="text-sm font-bold text-[#0A3D62] dark:text-gray-200">
											{t("wifiSetup.recoveryTitle")}
										</p>
										<p className="mt-1 text-xs text-[#3D5568] dark:text-gray-400">
											{t("wifiSetup.recovery")}
										</p>
									</div>
								)}
							</DashboardSection>
						</>
					),
				}}
			/>
		</div>
	);
}
