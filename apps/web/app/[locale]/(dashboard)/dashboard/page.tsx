import { EnergyControllerCard } from "@/components/EnergyControllerCard";
import { FeedLevelCard } from "@/components/FeedLevelCard";
import { FeedNowButton } from "@/components/FeedNowButton";
import { FeedingPredictionCard } from "@/components/FeedingPredictionCard";
import { TimeCalibrationForm } from "@/components/TimeCalibrationForm";
import { WaterTempCard } from "@/components/WaterTempCard";
import { PakoyLowHopper } from "@/components/assistant/pakoy-low-hopper";
import { type ChartLabels, LineTrend, StackedBars } from "@/components/charts";
import { formatChartNumber } from "@/components/charts/chart-data";
import {
	CONTROL_ROOM_MAIN,
	CONTROL_ROOM_ORDER,
	ControlPanel,
	ControlRoomLayout,
	ControlRoomRail,
} from "@/components/dashboard/control-room/control-room-shell";
import { NextFeedingStrip } from "@/components/dashboard/control-room/next-feeding-strip";
import {
	PondOverview,
	type PondOverviewFeeder,
} from "@/components/dashboard/control-room/pond-overview";
import {
	AdvisorSummary,
	AlertsPanel,
	type ControlRoomAlert,
	GrowOutPanel,
	PondSummary,
	RecentFeedings,
	StatTile,
} from "@/components/dashboard/control-room/rail-panels";
import {
	DashboardEmptyState,
	DashboardPageHeader,
	ReadOnlyNotice,
} from "@/components/dashboard/dashboard-ui";
import { TermInfo } from "@/components/dashboard/term-info";
import { ExportPdfButton } from "@/components/export-pdf-button";
import { DashboardSnapshot } from "@/components/pwa/dashboard-snapshot";
import { SnapshotWriter } from "@/components/pwa/snapshot-writer";
import { Link } from "@/i18n/routing";
import { canWrite, getCurrentUser } from "@/lib/auth/session";
import { computeCalibrationDrift } from "@/lib/calibration/drift";
import { loadCalibrationDriftWindow } from "@/lib/calibration/drift-data";
import { getRecalibrationStatus } from "@/lib/calibration/recalibration";
import { DEFAULT_HOPPER_RANGE, WATER_TEMP_RANGES, parseWaterTempRange } from "@/lib/chart-windows";
import { todayDateOnly } from "@/lib/crop-cycle/dates";
import { toPredictionCycleContext } from "@/lib/crop-cycle/prediction-context";
import { formatFarmDateTime, formatWallClockTime } from "@/lib/date-local";
import { toHopperSnapshot } from "@/lib/device-hopper";
import { evaluateDeviceStatus } from "@/lib/device-status";
import { feedPerMealG, totalBiomassG } from "@/lib/feed-calc";
import { formatFeedAmountLabel } from "@/lib/feed-figures";
import { feedSourceKey } from "@/lib/feed-sources";
import { getFeedNowLimitForDevice } from "@/lib/feed/feed-now-limit";
import type { DashboardSnapshotData } from "@/lib/offline/snapshots";
import { getFeedPerDayBySource, getHopperLevelSeries, getWaterTempSeries } from "@/lib/pond-charts";
import { getActivePond } from "@/lib/pond-selection";
import { computeDeterministicPrediction } from "@/lib/prediction";
import prisma from "@/lib/prisma";
import { computeNextFeedingSlot } from "@/lib/schedule/next-feeding-slot";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
import { getOrgSettingsForFarm } from "@/lib/settings/org";
import { cn } from "@/lib/utils";
import {
	AlertTriangle,
	Brain,
	Calendar,
	Clock,
	Layers,
	Sliders,
	Sparkles,
	TrendingUp,
	Wheat,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0; // Ensure data is always fresh

interface DashboardHomePageProps {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardHomePage({ searchParams }: DashboardHomePageProps) {
	const params = await searchParams;
	const waterRange = parseWaterTempRange(first(params.water));
	const [t, tBtn, tHist, tPred, tHarvest, tDates, tCommon, writeAccess, currentUser, pond] =
		await Promise.all([
			getTranslations("dashboard.home"),
			getTranslations("button"),
			getTranslations("dashboard.history"),
			getTranslations("dashboard.growth.prediction"),
			getTranslations("dashboard.harvest.summary"),
			getTranslations("dates"),
			getTranslations("dashboard.common"),
			canWrite(),
			getCurrentUser(),
			getActivePond({
				energyDevices: {
					orderBy: { createdAt: "asc" },
					select: { id: true, label: true },
				},
			}),
		]);

	// The legacy Device table is no longer written, so a pond counts as set up
	// once an EnergyDevice is registered on it.
	if (!pond || !pond.energyDevices.length) {
		return (
			<div className="mx-auto max-w-2xl py-10">
				<DashboardEmptyState icon={Wheat} title={t("noData")} description={t("noPondHint")} />
			</div>
		);
	}

	const device = {
		id: pond.energyDevices[0].id,
		name: pond.energyDevices[0].label,
	};

	// One parallel wave for independent reads. Every device on the pond is read
	// so the pond overview can pin each feeder; the first one stays the primary
	// device for the schedule, controller and predictions.
	const [energyDevices, recentBiomassLogs, fcrReports, activeCycle, orgSettings, statusPolicy] =
		await Promise.all([
			prisma.energyDevice.findMany({
				where: { pondId: pond.id },
				orderBy: { createdAt: "asc" },
				select: {
					id: true,
					mac: true,
					label: true,
					rtcOk: true,
					feederActive: true,
					isPaused: true,
					gramsPerFeeding: true,
					gramsPerSecond: true,
					lastSeenAt: true,
					feedLevelPercent: true,
					feedLevelUpdatedAt: true,
					hopperCapacityG: true,
					dailyCapG: true,
					lastCalibratedAt: true,
					recalibrationIntervalDays: true,
					waterTempC: true,
					waterTempOk: true,
					waterTempUpdatedAt: true,
				},
			}),
			prisma.biomassLog.findMany({
				where: { pondId: pond.id },
				orderBy: { recordedAt: "desc" },
				take: 5,
				include: { fishSamples: { select: { id: true } } },
			}),
			prisma.fcrReport.findMany({
				where: { pondId: pond.id },
				orderBy: { periodEnd: "asc" },
				take: 5,
			}),
			prisma.cropCycle.findFirst({
				where: { pondId: pond.id, status: "ACTIVE" },
				select: {
					id: true,
					label: true,
					stockingDate: true,
					stockingCount: true,
					growOutDays: true,
					targetHarvestDate: true,
					targetHarvestWeightG: true,
					expectedSurvivalPct: true,
				},
			}),
			// The low-hopper threshold is an org setting (#190); the dashboard alert
			// must honour it instead of the hard-coded default.
			getOrgSettingsForFarm(pond.ownerId),
			getDeviceStatusPolicy(),
		]);

	const energyDevice = energyDevices[0] ?? null;
	const deviceIds = energyDevices.map((row) => row.id);
	const now = new Date();
	const hopper = energyDevice ? toHopperSnapshot(energyDevice, now, statusPolicy) : null;
	const connection = evaluateDeviceStatus({
		lastSeenAt: energyDevice?.lastSeenAt ?? null,
		now,
		policy: statusPolicy,
	});

	const latestBiomass = recentBiomassLogs[0] ?? null;

	// Schedule resolution needs the device id; feeding history, the charts and
	// the drift check use the same ids, so they share the second wave. The
	// water-temperature trend is scoped to the primary device.
	const [
		currentConfig,
		feedingHistory,
		waterTempPoints,
		feedChart,
		hopperPoints,
		driftWindow,
		feedNowLimit,
	] = await Promise.all([
		resolveCurrentSchedule(pond.id, energyDevice?.id ?? null),
		energyDevice
			? prisma.feedEvent.findMany({
					where: { deviceId: energyDevice.id, eventType: "feed_dispensed" },
					orderBy: { receivedAt: "desc" },
					take: 5,
				})
			: Promise.resolve([]),
		energyDevice ? getWaterTempSeries([energyDevice.id], waterRange) : Promise.resolve([]),
		getFeedPerDayBySource(deviceIds),
		getHopperLevelSeries(deviceIds, DEFAULT_HOPPER_RANGE),
		// One loader for every surface (#6): device output only, seven days.
		energyDevice
			? loadCalibrationDriftWindow(energyDevice.id, now)
			: Promise.resolve({ feeds: [], levels: [], start: now }),
		// The Feed Now ceiling (issue #387) is the lower of the pond/device
		// per-meal dose, the remaining daily allowance and the hard ceiling.
		energyDevice ? getFeedNowLimitForDevice(energyDevice) : Promise.resolve(null),
	]);

	const latestFcr = fcrReports.length > 0 ? fcrReports[fcrReports.length - 1].fcrValue : 0.0;
	const cycleContext = activeCycle ? toPredictionCycleContext(activeCycle, todayDateOnly()) : null;

	// The advisor is surfaced on the home page so it is not hidden behind the
	// Growth tab. The server renders the deterministic value instantly; the
	// client card refines it with the AI provider in the background.
	const initialPrediction = computeDeterministicPrediction({
		feedingRatePct: currentConfig?.feedingRatePct ?? pond.feedingRatePct,
		feedsPerDay: currentConfig?.feedsPerDay ?? pond.feedsPerDay,
		population: pond.population,
		avgWeightKg: latestBiomass?.avgWeightKg ?? null,
		latestFcr: fcrReports.length > 0 ? latestFcr : null,
		currentGrams: energyDevice?.gramsPerFeeding ?? null,
		hopperCapacityG: energyDevice?.hopperCapacityG ?? null,
		dailyCapG: energyDevice?.dailyCapG ?? null,
		lastSampleAt: latestBiomass?.recordedAt ?? null,
		isFallow: pond.isFallow,
		cycle: cycleContext,
	});

	// Calculate next feeding time. The stored schedule is a farm wall clock
	// (Asia/Manila), so the comparison must be wall clock against wall clock —
	// the server renders in UTC and a local-time comparison would be 8 hours off.
	const feedsPerDay = currentConfig?.feedsPerDay ?? pond.feedsPerDay;
	const feedingRatePct = currentConfig?.feedingRatePct ?? pond.feedingRatePct;
	const nextFeedingSlot = computeNextFeedingSlot({
		scheduleStart: currentConfig?.scheduleStart ?? pond.scheduleStart,
		scheduleEnd: currentConfig?.scheduleEnd ?? pond.scheduleEnd,
		feedsPerDay,
		now,
	});

	const formatTime = (d: Date) => formatFarmDateTime(d, tDates).time;
	const formatDate = (d: Date) => formatFarmDateTime(d, tDates).date;

	const nextFeedingTimeStr = nextFeedingSlot
		? formatWallClockTime(nextFeedingSlot.hours, nextFeedingSlot.minutes, tDates)
		: "—";

	// Daily Feed (g) = Total Biomass (g) × Feeding Rate (%)
	// Feed per Meal (g) = Daily Feed (g) ÷ Feeds Per Day  (see lib/feed-calc.ts)
	const pondPopulation = pond.population;
	let nextFeedingVolumeG: number | null = energyDevice?.gramsPerFeeding ?? null;
	if (latestBiomass) {
		const recommended = feedPerMealG(
			totalBiomassG(pondPopulation, latestBiomass.avgWeightKg),
			feedingRatePct,
			feedsPerDay,
		);
		if (recommended !== null) nextFeedingVolumeG = recommended;
	}

	// Calculate days until next physical weighing (assuming every 14 days)
	const daysSinceSample = latestBiomass
		? Math.floor((now.getTime() - latestBiomass.recordedAt.getTime()) / (1000 * 60 * 60 * 24))
		: 0;
	const daysUntilSample = Math.max(0, (pond.sampleIntervalDays ?? 14) - daysSinceSample);

	// Determine Critical Alert — lazy offline detection from energyDevice.lastSeenAt
	const esp32Offline = connection.isOffline;
	const criticalAlert = esp32Offline && !!energyDevice;
	const isPaused = energyDevice?.isPaused ?? false;
	const recalibration = getRecalibrationStatus(
		energyDevice?.lastCalibratedAt ?? null,
		energyDevice?.recalibrationIntervalDays ?? 30,
		now,
	);
	const drift = computeCalibrationDrift({
		feeds: driftWindow.feeds,
		levels: driftWindow.levels,
		hopperCapacityG: energyDevice?.hopperCapacityG ?? null,
	});

	const chartLabels: ChartLabels = {
		period: tCommon("charts.period"),
		value: tCommon("charts.value"),
		name: tCommon("charts.name"),
		empty: tCommon("charts.empty"),
	};
	const waterRangeLabel = waterRange === "24h" ? t("waterRange24h") : t("waterRange7d");
	const latestWaterTemp =
		energyDevice?.waterTempOk && energyDevice.waterTempC !== null
			? `${energyDevice.waterTempC.toFixed(1)}°C`
			: "—";

	const sourceSeriesLabels = Object.fromEntries(
		feedChart.stack.sources.map((source) => [source, tHist(`source_${feedSourceKey(source)}`)]),
	);
	const feedChartTotal = Object.values(feedChart.stack.totalsBySource).reduce(
		(sum, value) => sum + value,
		0,
	);
	const hopperLatest = hopperPoints.at(-1)?.value ?? null;

	function formatOfflineDuration(lastSeenAt: Date | null): string {
		if (!lastSeenAt) return t("durationNotConnected");
		const ms = now.getTime() - lastSeenAt.getTime();
		const totalMinutes = Math.floor(ms / 60000);
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		if (hours > 24) {
			const days = Math.floor(hours / 24);
			const remainHours = hours % 24;
			return remainHours > 0
				? t("durationDaysHours", { days, hours: remainHours })
				: t("durationDays", { days });
		}
		if (hours > 0) return t("durationHoursMinutes", { hours, minutes });
		return t("durationMinutes", { minutes });
	}

	const dashboardSnapshot: DashboardSnapshotData = {
		pondName: pond.name,
		deviceName: energyDevice?.label ?? device.name,
		deviceStatus: energyDevice ? connection.state : "missing",
		lastSeenAt: energyDevice?.lastSeenAt?.toISOString() ?? null,
		feedLevelPercent: energyDevice?.feedLevelPercent ?? null,
		feedLevelUpdatedAt: energyDevice?.feedLevelUpdatedAt?.toISOString() ?? null,
		waterTempC: energyDevice?.waterTempC ?? null,
		waterTempOk: energyDevice?.waterTempOk ?? null,
		waterTempUpdatedAt: energyDevice?.waterTempUpdatedAt?.toISOString() ?? null,
		population: pond.population,
		avgWeightG: latestBiomass ? latestBiomass.avgWeightKg * 1000 : null,
		latestFcr: fcrReports.length > 0 ? latestFcr : null,
		nextFeedingTime: isPaused ? null : nextFeedingTimeStr,
		nextFeedingVolumeG: pond.isFallow ? 0 : nextFeedingVolumeG,
		daysUntilSample,
		activeCycleLabel: activeCycle?.label ?? null,
		targetHarvestDate: activeCycle?.targetHarvestDate
			? activeCycle.targetHarvestDate.toISOString().slice(0, 10)
			: null,
		isPaused,
	};

	const feeders: PondOverviewFeeder[] = energyDevices.map((row) => {
		const rowStatus = evaluateDeviceStatus({
			lastSeenAt: row.lastSeenAt,
			now,
			policy: statusPolicy,
		});
		return {
			id: row.id,
			label: row.label,
			status: rowStatus.state,
			isOffline: rowStatus.isOffline,
			isPaused: row.isPaused,
			levelPercent: row.feedLevelPercent,
			levelUpdatedAt: row.feedLevelUpdatedAt,
			nextFeedLabel: row.isPaused ? null : nextFeedingTimeStr,
			waterTempLabel:
				row.waterTempOk && row.waterTempC !== null ? `${row.waterTempC.toFixed(1)} °C` : null,
		};
	});

	// The rail's alerts are derived from the same reads as the cards above; the
	// offline banner is repeated from the page-level critical alert.
	const alerts: ControlRoomAlert[] = [];
	if (criticalAlert && energyDevice) {
		alerts.push({
			id: "offline",
			tone: "danger",
			title: t("controlRoom.alerts.offlineTitle", {
				duration: formatOfflineDuration(energyDevice.lastSeenAt),
			}),
			detail: t("controlRoom.alerts.offlineDetail", { device: device.name }),
			href: "/dashboard/settings/hardware",
			linkLabel: t("controlRoom.alerts.openHardware"),
		});
	}
	if (energyDevice?.feedLevelPercent !== null && energyDevice?.feedLevelPercent !== undefined) {
		if (energyDevice.feedLevelPercent < orgSettings.settings.hopperLowPct) {
			alerts.push({
				id: "hopper-low",
				tone: "warning",
				title: t("controlRoom.alerts.lowHopperTitle", {
					percent: Math.round(energyDevice.feedLevelPercent),
				}),
				detail: t("controlRoom.alerts.lowHopperDetail"),
				href: "/dashboard/settings/hardware",
				linkLabel: t("controlRoom.alerts.openHardware"),
			});
		}
	}
	if (recalibration.isOverdue) {
		alerts.push({
			id: "recalibration",
			tone: "warning",
			title: t("controlRoom.alerts.recalibrationTitle", {
				days: recalibration.daysOverdue,
			}),
			detail: t("controlRoom.alerts.recalibrationDetail"),
			href: "/dashboard/settings/hardware",
			linkLabel: t("controlRoom.alerts.openHardware"),
		});
	}
	if (drift.status === "drift" && drift.diffPct !== null) {
		alerts.push({
			id: "drift",
			tone: "info",
			title: t("controlRoom.alerts.driftTitle", {
				percent: Math.abs(drift.diffPct).toFixed(1),
			}),
			detail: t("controlRoom.alerts.driftDetail"),
			href: "/dashboard/settings/hardware",
			linkLabel: t("controlRoom.alerts.openHardware"),
		});
	}

	const advisorReasoning = initialPrediction.reasoning || null;
	const pondMeta = [
		{
			label: t("populationLabel"),
			value: pond.population ? t("populationValue", { count: pond.population }) : "—",
		},
		{
			label: t("controlRoom.cycleLabel"),
			value: activeCycle?.label || t("controlRoom.noCycle"),
		},
	];
	const feedingRows = feedingHistory.map((item) => ({
		id: item.id,
		time: formatTime(item.receivedAt),
		date: formatDate(item.receivedAt),
		sourceLabel: tHist(item.source ? `source_${feedSourceKey(item.source)}` : "confirmedDispense"),
		grams: formatFeedAmountLabel(item.grams),
	}));

	return (
		<>
			<SnapshotWriter
				page="dashboard"
				scope={pond.ownerId}
				pondId={pond.id}
				pondName={pond.name}
				data={dashboardSnapshot}
			/>
			<DashboardSnapshot snapshot={dashboardSnapshot} />

			{/* Pakoy's in-context low-hopper reminder (#221). The permanent
			    record stays in the bell and on the hardware page. */}
			{energyDevice &&
				energyDevice.feedLevelPercent !== null &&
				energyDevice.feedLevelPercent < orgSettings.settings.hopperLowPct && (
					<PakoyLowHopper
						pondId={pond.id}
						levelPercent={Math.round(energyDevice.feedLevelPercent)}
						low
					/>
				)}

			<ControlRoomLayout>
				{criticalAlert && (
					<section
						role="alert"
						className={cn(
							CONTROL_ROOM_ORDER.alert,
							"xl:hidden rounded-2xl bg-[#C42B3A] px-4 py-3 text-white shadow-lg",
						)}
					>
						<div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="flex items-start gap-3">
								<div
									aria-hidden="true"
									className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/15 font-black"
								>
									!
								</div>
								<div>
									<p className="text-sm font-black md:text-base">
										{t("criticalTitle", {
											duration: formatOfflineDuration(energyDevice?.lastSeenAt ?? null),
										})}
									</p>
									<p className="text-xs font-semibold text-white/90">
										{t("criticalDesc", { device: device.name })}
									</p>
								</div>
							</div>
							<Link
								href="/dashboard/settings"
								className="flex min-h-11 items-center justify-center rounded-2xl bg-white px-4 text-sm font-black text-[#C42B3A] transition hover:bg-white/90 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
							>
								{t("viewDetails")}
							</Link>
						</div>
					</section>
				)}

				<NextFeedingStrip
					className={cn(CONTROL_ROOM_ORDER.hero, CONTROL_ROOM_MAIN.hero)}
					pondName={pond.name}
					label={t("nextFeedingLabel")}
					time={nextFeedingTimeStr}
					timeSrLabel={t("nextFeedingTimeLabel")}
					isPaused={isPaused}
					statusLabel={isPaused ? t("schedulePaused") : t("timerOn")}
					volumeLabel={t("feedVolumeLabel")}
					volumeValue={pond.isFallow ? "—" : `${nextFeedingVolumeG} g`}
					rateLabel={t("feedRateLabel")}
					rateValue={`${feedingRatePct}${t("feedRateSuffix")}`}
					basedOn={
						latestBiomass ? t("basedOnLog", { date: formatDate(latestBiomass.recordedAt) }) : null
					}
					updateLabel={tBtn("updateBiomass")}
					updateHref="/dashboard/log-sample"
				/>

				<PondOverview
					className={cn(CONTROL_ROOM_ORDER.canvas, CONTROL_ROOM_MAIN.canvas)}
					pondName={pond.name}
					feeders={feeders}
				/>

				<div className={cn(CONTROL_ROOM_ORDER.charts, CONTROL_ROOM_MAIN.charts, "min-w-0")}>
					<div className="mb-2 flex items-center justify-end">
						<nav aria-label={t("waterRangeLabel")} className="flex flex-wrap items-center gap-1.5">
							{WATER_TEMP_RANGES.map((option) => (
								<Link
									key={option}
									href={`/dashboard?water=${option}`}
									aria-current={option === waterRange ? "page" : undefined}
									className={cn(
										"inline-flex min-h-9 items-center rounded-lg px-3 text-[11px] font-black transition-colors focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]",
										option === waterRange
											? "bg-[#0A3D62] text-white shadow-sm"
											: "border border-[#0A3D62]/20 bg-white text-[#0A3D62] hover:bg-[#F4F7F6] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800",
									)}
								>
									{option === "24h" ? t("waterRange24h") : t("waterRange7d")}
								</Link>
							))}
						</nav>
					</div>

					<div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
						<StackedBars
							className="min-w-0 xl:p-3"
							title={t("controlRoom.charts.feedTitle")}
							summary={t("controlRoom.charts.feedSummary", {
								total: formatChartNumber(feedChartTotal, "g"),
							})}
							labels={chartLabels}
							stack={feedChart.stack}
							seriesLabels={sourceSeriesLabels}
							unit="g"
							height={130}
						/>
						<LineTrend
							className="min-w-0 xl:p-3"
							title={t("controlRoom.charts.hopperTitle")}
							summary={t("controlRoom.charts.hopperSummary", {
								latest: hopperLatest ?? "—",
							})}
							labels={{ ...chartLabels, empty: t("controlRoom.charts.hopperEmpty") }}
							points={hopperPoints}
							unit="%"
							decimals={0}
							height={130}
						/>
						<LineTrend
							className="min-w-0 xl:p-3"
							title={t("waterChartTitle")}
							summary={t("waterChartSummary", {
								range: waterRangeLabel,
								points: waterTempPoints.length,
								latest: latestWaterTemp,
							})}
							labels={{ ...chartLabels, empty: t("waterChartEmpty") }}
							points={waterTempPoints}
							unit="°C"
							decimals={1}
							height={130}
						/>
					</div>
				</div>

				<ControlRoomRail label={t("controlRoom.railLabel")}>
					<div className={CONTROL_ROOM_ORDER.header}>
						<DashboardPageHeader
							title={
								currentUser?.displayName
									? t("welcome", { name: currentUser.displayName })
									: t("welcomeBack")
							}
							description={t.rich("monitoring", {
								pond: pond.name,
								bold: (chunks) => <strong>{chunks}</strong>,
							})}
							mascot="idle"
							summary={
								isPaused
									? t("greetingPaused")
									: nextFeedingSlot
										? t("greetingNextFeeding", { time: nextFeedingTimeStr })
										: undefined
							}
							actions={<ExportPdfButton />}
						>
							{!writeAccess && (
								<ReadOnlyNotice
									title={tCommon("readOnlyTitle")}
									description={tCommon("readOnlyDesc")}
								/>
							)}
						</DashboardPageHeader>
					</div>

					<div className={CONTROL_ROOM_ORDER.pond}>
						<ControlPanel title={t("controlRoom.pondPanel")} icon={Wheat}>
							<PondSummary
								name={pond.name}
								meta={pondMeta}
								href="/dashboard/settings/pond"
								linkLabel={t("controlRoom.pondLink")}
							/>
						</ControlPanel>
					</div>

					<div
						className={cn(
							CONTROL_ROOM_ORDER.feedNow,
							"rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900",
						)}
					>
						<FeedNowButton
							deviceId={energyDevice?.id ?? device.id}
							nextFeedingVolume={pond.isFallow ? "0g" : `${nextFeedingVolumeG}g`}
							label={tBtn("feedNow")}
							deviceName={energyDevice?.label ?? device.name}
							connectionStatus={connection.state}
							hopperLevelPct={hopper?.levelPercent ?? null}
							canWrite={writeAccess}
							isFallow={pond.isFallow}
							gramsPerSecond={energyDevice?.gramsPerSecond}
							feedNowLimit={feedNowLimit}
							data-onboard="feed-now"
						/>
					</div>

					{energyDevice && (
						<div className={CONTROL_ROOM_ORDER.device}>
							<FeedLevelCard
								levelPercent={hopper?.levelPercent ?? null}
								updatedAt={hopper?.levelUpdatedAt ?? null}
								hopperCapacityG={hopper?.hopperCapacityG ?? null}
								gramsPerFeeding={energyDevice.gramsPerFeeding}
								feedsPerDay={feedsPerDay}
								isDeviceOffline={hopper?.isOffline ?? esp32Offline}
							/>
						</div>
					)}

					{energyDevice && (
						<div className={CONTROL_ROOM_ORDER.water}>
							<WaterTempCard
								tempC={energyDevice.waterTempC}
								tempOk={energyDevice.waterTempOk}
								updatedAt={energyDevice.waterTempUpdatedAt}
								isDeviceOffline={esp32Offline}
							/>
						</div>
					)}

					<div className={CONTROL_ROOM_ORDER.alerts}>
						<ControlPanel title={t("controlRoom.alertsPanel")} icon={AlertTriangle}>
							<AlertsPanel
								items={alerts}
								emptyTitle={t("controlRoom.alerts.emptyTitle")}
								emptyDescription={t("controlRoom.alerts.emptyDetail")}
							/>
						</ControlPanel>
					</div>

					{!pond.isFallow && energyDevice && (
						<div className={cn(CONTROL_ROOM_ORDER.advisorSummary, "hidden xl:block")}>
							<ControlPanel title={t("controlRoom.advisorPanel")} icon={Brain}>
								<AdvisorSummary
									grams={initialPrediction.grams}
									gramsLabel={t("controlRoom.advisorGramsLabel")}
									unit="g"
									confidenceLabel={t("controlRoom.advisorConfidence")}
									confidence={tPred(`confidence_${initialPrediction.confidence}`)}
									reasoning={advisorReasoning}
									emptyLabel={t("controlRoom.advisorEmpty")}
									href="/dashboard/growth"
									linkLabel={t("controlRoom.advisorLink")}
								/>
							</ControlPanel>
						</div>
					)}

					{/* The full advisor card stays for phones; the rail shows a summary. */}
					<div className={cn(CONTROL_ROOM_ORDER.advisorFull, "xl:hidden")}>
						{pond.isFallow ? (
							<div className="flex flex-col gap-4 rounded-3xl border border-dashed border-[#0A3D62]/20 bg-white p-6 dark:border-white/10 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between">
								<div className="flex items-start gap-3">
									<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]">
										<Wheat aria-hidden="true" className="h-6 w-6" />
									</div>
									<div>
										<p className="text-sm font-black text-gray-900 dark:text-gray-100">
											{tHarvest("fallowTitle")}
										</p>
										<p className="mt-0.5 max-w-xl text-xs text-gray-500 dark:text-gray-400">
											{tHarvest("fallowDesc")}
										</p>
									</div>
								</div>
								<Link
									href="/dashboard/calendar"
									className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#164e7c] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:bg-[#1f66a0]"
								>
									{tHarvest("startCycle")}
								</Link>
							</div>
						) : (
							energyDevice && (
								<FeedingPredictionCard
									deviceId={energyDevice.id}
									initialPrediction={initialPrediction}
									canWrite={writeAccess}
									pondName={pond.name}
								/>
							)
						)}
					</div>

					{activeCycle && cycleContext && (
						<div className={CONTROL_ROOM_ORDER.growOut}>
							<ControlPanel title={t("controlRoom.growOutPanel")} icon={Calendar}>
								<GrowOutPanel
									title={activeCycle.label || tHarvest("cycle")}
									detail={
										<>
											{tHarvest("dayOf", {
												day: cycleContext.growOutDay,
												total: activeCycle.growOutDays,
											})}{" "}
											·{" "}
											{cycleContext.daysToHarvest < 0
												? tHarvest("overdueBy", {
														days: Math.abs(cycleContext.daysToHarvest),
													})
												: tHarvest("harvestIn", { days: cycleContext.daysToHarvest })}
											{activeCycle.targetHarvestWeightG
												? ` · ${activeCycle.targetHarvestWeightG} g`
												: ""}
										</>
									}
									href="/dashboard/calendar"
									linkLabel={t("controlRoom.growOutLink")}
								/>
							</ControlPanel>
						</div>
					)}

					<div data-help="dashboard-feed-log" className={CONTROL_ROOM_ORDER.feedings}>
						<ControlPanel title={t("controlRoom.feedingsPanel")} icon={Clock}>
							<RecentFeedings
								rows={feedingRows}
								emptyTitle={t("noFeedings")}
								emptyHint={t("noFeedingsHint")}
								href="/dashboard/history"
								linkLabel={tBtn("viewHistory")}
							/>
						</ControlPanel>
					</div>

					{recentBiomassLogs.length > 0 && (
						<div data-help="dashboard-biomass-log" className={CONTROL_ROOM_ORDER.biomass}>
							<ControlPanel title={t("biomassLogsTitle")} icon={Layers}>
								<ul className="space-y-1.5">
									{recentBiomassLogs.slice(0, 3).map((log) => (
										<li
											key={log.id}
											className="flex items-center justify-between gap-2 rounded-xl bg-[#F7F9F8] px-2.5 py-1.5 dark:bg-gray-800/60"
										>
											<div className="min-w-0">
												<p className="text-xs font-black text-[#0A3D62] dark:text-gray-100">
													{formatDate(log.recordedAt)}
												</p>
												<p className="truncate text-[10px] font-semibold text-[#3D5568] dark:text-gray-400">
													{log.fishSamples.length > 0
														? t("logFishCount", { count: log.fishSamples.length })
														: t("logAvgSamples", { count: log.sampleCount })}
												</p>
											</div>
											<span className="shrink-0 text-xs font-black text-[#0A3D62] dark:text-[#5b9bd5]">
												{(log.avgWeightKg * 1000).toFixed(1)} g
											</span>
										</li>
									))}
								</ul>
								<Link
									href="/dashboard/growth"
									className="mt-2 inline-flex min-h-8 items-center gap-1 text-[11px] font-black text-[#C2410C] hover:underline focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-[#ff8a5c]"
								>
									{t("viewGrowth")}
								</Link>
							</ControlPanel>
						</div>
					)}

					<div className={CONTROL_ROOM_ORDER.stats}>
						<ControlPanel title={t("controlRoom.statsPanel")} icon={TrendingUp}>
							<div className="grid grid-cols-2 gap-2">
								<div data-help="fcr" data-onboard="fcr">
									<StatTile
										label={
											<TermInfo
												label={t("currentFcrLabel")}
												hint={tCommon("terminology.aboutFcr")}
												description={tCommon("terminology.fcr")}
											/>
										}
										value={fcrReports.length > 0 ? latestFcr.toFixed(2) : "—"}
										detail={t("fcrTag")}
										icon={Sparkles}
										href="/dashboard/growth"
									/>
								</div>
								<StatTile
									label={t("weighingDue")}
									value={t("days", { count: daysUntilSample })}
									icon={Calendar}
									href="/dashboard/log-sample"
								/>
								<StatTile
									label={
										<TermInfo
											label={t("lastBiomassLabel")}
											hint={tCommon("terminology.aboutAbw")}
											description={tCommon("terminology.abw")}
										/>
									}
									value={
										latestBiomass ? `${(latestBiomass.avgWeightKg * 1000).toFixed(1)} g` : t("na")
									}
									detail={
										latestBiomass
											? t("lastBiomassBased", { count: latestBiomass.sampleCount })
											: undefined
									}
									icon={Sliders}
									href="/dashboard/log-sample"
								/>
								<StatTile
									label={t("populationLabel")}
									value={pond.population ? t("populationValue", { count: pond.population }) : "—"}
									detail={t("populationStable")}
									icon={Layers}
								/>
							</div>
						</ControlPanel>
					</div>

					{energyDevice && (
						<div className={cn(CONTROL_ROOM_ORDER.controller, "min-w-0 space-y-3")}>
							<ControlPanel title={t("controlRoom.controlsPanel")} icon={Sliders}>
								<EnergyControllerCard
									deviceId={energyDevice.id}
									label={energyDevice.label}
									mac={energyDevice.mac}
									rtcOk={energyDevice.rtcOk}
									feederActive={energyDevice.feederActive}
									gramsPerFeeding={energyDevice.gramsPerFeeding}
									gramsPerSecond={energyDevice.gramsPerSecond}
									lastSeenAt={energyDevice.lastSeenAt}
									isOffline={esp32Offline}
									canWrite={writeAccess}
									recalibrationDue={recalibration.isOverdue}
									recalibrationDaysOverdue={recalibration.daysOverdue}
									feedNowLimit={feedNowLimit}
								/>
							</ControlPanel>
							<TimeCalibrationForm deviceId={energyDevice.id} canWrite={writeAccess} />
						</div>
					)}
				</ControlRoomRail>
			</ControlRoomLayout>
		</>
	);
}
