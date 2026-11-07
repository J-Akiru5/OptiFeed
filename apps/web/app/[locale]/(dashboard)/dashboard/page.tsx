import { EnergyControllerCard } from "@/components/EnergyControllerCard";
import { FeedLevelCard } from "@/components/FeedLevelCard";
import { FeedNowButton } from "@/components/FeedNowButton";
import { FeedingPredictionCard } from "@/components/FeedingPredictionCard";
import { TimeCalibrationForm } from "@/components/TimeCalibrationForm";
import { WaterTempCard } from "@/components/WaterTempCard";
import { PakoyLowHopper } from "@/components/assistant/pakoy-low-hopper";
import { formatChartNumber } from "@/components/charts/chart-data";
import type { ChartLabels } from "@/components/charts/chart-frame";
import { LazyLineTrend, LazyStackedBars } from "@/components/charts/lazy";
import {
	CONTROL_ROOM_MAIN,
	CONTROL_ROOM_MOBILE_BAND,
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
import { HealthNotice } from "@/components/feeder/health-notice";
import { DashboardSnapshot } from "@/components/pwa/dashboard-snapshot";
import { SnapshotWriter } from "@/components/pwa/snapshot-writer";
import { Link } from "@/i18n/routing";
import {
	biomassSamplesInWindow,
	computeFcrFromLogs,
	feedGivenKgInWindow,
	feedWindowForSamples,
	loadStoredFcrAssessments,
	resolveFcrDisplay,
	verifiedFcrValue,
} from "@/lib/analytics/fcr";
import { getCurrentPermissions, writeCapabilities } from "@/lib/auth/permissions";
import { canWrite, getCurrentUser } from "@/lib/auth/session";
import { computeCalibrationDrift } from "@/lib/calibration/drift";
import { loadCalibrationDriftWindow } from "@/lib/calibration/drift-data";
import { getRecalibrationStatus } from "@/lib/calibration/recalibration";
import { DEFAULT_HOPPER_RANGE, WATER_TEMP_RANGES, parseWaterTempRange } from "@/lib/chart-windows";
import { todayDateOnly } from "@/lib/crop-cycle/dates";
import { toPredictionCycleContext } from "@/lib/crop-cycle/prediction-context";
import { buildDashboardAlerts } from "@/lib/dashboard/alerts";
import { formatFarmDateTime, formatWallClockTime } from "@/lib/date-local";
import { getDeviceHealthSafe } from "@/lib/device-health";
import { HEALTHY_VIEW, deviceHealthNeedsAction } from "@/lib/device-health-model";
import { toHopperSnapshot } from "@/lib/device-hopper";
import { evaluateDeviceStatus, resolveRssiDbm } from "@/lib/device-status";
import { feedPerMealG, totalBiomassG } from "@/lib/feed-calc";
import { formatFeedAmountLabel } from "@/lib/feed-figures";
import { feedSourceKey } from "@/lib/feed-sources";
import { IN_FLIGHT_FEED_STATUSES } from "@/lib/feed/commands";
import { getFeedNowLimitForDevice } from "@/lib/feed/feed-now-limit";
import { getLiveCountForPond, mortalityRatePct } from "@/lib/growth/live-count";
import type { DashboardSnapshotData } from "@/lib/offline/snapshots";
import { getFeedPerDayBySource, getHopperLevelSeries, getWaterTempSeries } from "@/lib/pond-charts";
import { getActivePond } from "@/lib/pond-selection";
import { computeDeterministicPrediction } from "@/lib/prediction";
import prisma from "@/lib/prisma";
import { computeNextFeedingSlot } from "@/lib/schedule/next-feeding-slot";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { deviceSettingsHref } from "@/lib/settings/device-settings-tabs";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
import { getOrgSettingsForFarm } from "@/lib/settings/org";
import { hopperIsLow } from "@/lib/settings/org-alerts";
import { cn } from "@/lib/utils";
import {
	AlertTriangle,
	ArrowRight,
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
	const [t, tBtn, tHist, tPred, tHarvest, tDates, tCommon, tFcr, writeAccess, currentUser, pond] =
		await Promise.all([
			getTranslations("dashboard.home"),
			getTranslations("button"),
			getTranslations("dashboard.history"),
			getTranslations("dashboard.growth.prediction"),
			getTranslations("dashboard.harvest.summary"),
			getTranslations("dates"),
			getTranslations("dashboard.common"),
			getTranslations("dashboard.fcrProvenance"),
			canWrite(),
			getCurrentUser(),
			getActivePond({
				energyDevices: {
					orderBy: { createdAt: "asc" },
					select: { id: true, label: true },
				},
			}),
		]);

	// Control visibility mirrors the actions' `requirePermission` gates (#750).
	const can = writeCapabilities(writeAccess, await getCurrentPermissions());

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
					tempOffsetC: true,
					minFeedTempC: true,
					waterTempC: true,
					waterTempOk: true,
					waterTempUpdatedAt: true,
					wifiRssiDbm: true,
					wifiRssiUpdatedAt: true,
				},
			}),
			prisma.biomassLog.findMany({
				where: { pondId: pond.id },
				orderBy: { recordedAt: "desc" },
				take: 5,
				include: { fishSamples: { select: { id: true } } },
			}),
			// Newest first: the rail tile shows the latest report, and the
			// provenance assessment expects that order (#875).
			prisma.fcrReport.findMany({
				where: { pondId: pond.id },
				orderBy: { periodEnd: "desc" },
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
	const connection = evaluateDeviceStatus({
		lastSeenAt: energyDevice?.lastSeenAt ?? null,
		now,
		policy: statusPolicy,
		rssiDbm: resolveRssiDbm({
			rssiDbm: energyDevice?.wifiRssiDbm ?? null,
			updatedAt: energyDevice?.wifiRssiUpdatedAt ?? null,
			now,
			policy: statusPolicy,
		}),
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
		deviceHealth,
		liveCount,
		pendingCommandCount,
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
		// The Feed Now ceiling (issue #387 / #398) is what is left of today's
		// daily allowance; the daily ceiling is the only gram cap.
		energyDevice ? getFeedNowLimitForDevice(energyDevice) : Promise.resolve(null),
		// What the unit reports about itself (safe mode, faults); advisory here.
		energyDevice ? getDeviceHealthSafe(energyDevice.id, now) : Promise.resolve(HEALTHY_VIEW),
		// The same live-count source the growth page uses (#430/#452): stocked
		// minus mortality, so the dashboard cannot disagree with growth.
		getLiveCountForPond(pond.id, { population: pond.population }),
		// #819: a dose still waiting for the unit is an actionable alert in the
		// sidebar; the schedule keeps the retry/resync controls.
		energyDevice
			? prisma.feedRequest.count({
					where: {
						status: { in: [...IN_FLIGHT_FEED_STATUSES] },
						deviceId: energyDevice.id,
					},
				})
			: Promise.resolve(0),
	]);

	// #574: the hopper reading is only current while its sensor answers, so the
	// snapshot is built after the unit's health arrives.
	const hopper = energyDevice
		? toHopperSnapshot(
				energyDevice,
				now,
				statusPolicy,
				deviceHealth.faults.includes("hopper_sensor"),
			)
		: null;

	// Display the live count, not the stocked count (#430): the pond card and
	// the growth page must agree. The dose path still reads Pond.population.
	const livePopulation = liveCount.live ?? pond.population;
	const mortalityPct = mortalityRatePct(liveCount.dead, liveCount.stocked);
	const mortalityPctLabel = mortalityPct === null ? "—" : `${mortalityPct.toFixed(1)}%`;

	// Issue #875: FCR is computed from this pond's feed and biomass logs. Only
	// when that is impossible does a stored report appear, and then the tile
	// says so instead of presenting an imported number as measured.
	const fcrWindow = activeCycle
		? { cycleId: activeCycle.id, from: activeCycle.stockingDate, to: null }
		: { cycleId: null, from: null, to: null };
	const fcrSamples = await biomassSamplesInWindow(pond.id, fcrWindow);
	// Feed is summed over the same Asia/Manila sampling days as the gain
	// (develop's #709 scope fix), with artefacts excluded.
	const fcrFeedWindow = feedWindowForSamples(fcrSamples);
	const fcrFeedGivenKg = fcrFeedWindow ? await feedGivenKgInWindow(pond.id, fcrFeedWindow) : 0;
	const computedFcr = computeFcrFromLogs(fcrFeedGivenKg, fcrSamples, liveCount);
	const storedFcrAssessments = await loadStoredFcrAssessments(pond.id, fcrReports, {
		deviceIds,
	});
	const fcrDisplay = resolveFcrDisplay(computedFcr.fcr, storedFcrAssessments);
	const latestFcr = fcrDisplay?.value ?? null;
	// Predictions only consume a value the logs reproduce.
	const predictionFcr = verifiedFcrValue(fcrDisplay);
	// A contradiction is the strongest signal, so the short label keeps it
	// even when a coverage reason is listed first.
	const primaryFcrReason = fcrDisplay?.unverifiedReasons.includes("stored-contradicts-totals")
		? "stored-contradicts-totals"
		: fcrDisplay?.unverifiedReasons[0];
	const fcrTileDetail =
		fcrDisplay?.source === "stored"
			? primaryFcrReason
				? tFcr(`short.${primaryFcrReason}`)
				: tFcr("storedVerifiedShort")
			: t("fcrTag");
	const cycleContext = activeCycle ? toPredictionCycleContext(activeCycle, todayDateOnly()) : null;

	// The advisor is surfaced on the home page so it is not hidden behind the
	// Growth tab. The server renders the deterministic value instantly; the
	// client card refines it with the AI provider in the background.
	const initialPrediction = computeDeterministicPrediction({
		feedingRatePct: currentConfig?.feedingRatePct ?? pond.feedingRatePct,
		feedsPerDay: currentConfig?.feedsPerDay ?? pond.feedsPerDay,
		population: pond.population,
		avgWeightKg: latestBiomass?.avgWeightKg ?? null,
		latestFcr: predictionFcr,
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

	// Lazy offline detection from energyDevice.lastSeenAt; the alert builder
	// turns it into the sidebar row and the mobile banner (#819).
	const esp32Offline = connection.isOffline;
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
		population: livePopulation ?? 0,
		avgWeightG: latestBiomass ? latestBiomass.avgWeightKg * 1000 : null,
		latestFcr: predictionFcr,
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
			rssiDbm: resolveRssiDbm({
				rssiDbm: row.wifiRssiDbm,
				updatedAt: row.wifiRssiUpdatedAt,
				now,
				policy: statusPolicy,
			}),
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

	// One decision, two surfaces (#412): the sidebar alert and Pakoy's reminder
	// use the same inclusive threshold as the server's `hopperAlertTier`, so at
	// exactly `hopperLowPct` the bell and the dashboard no longer disagree.
	const hopperLevelPercent = energyDevice?.feedLevelPercent ?? null;
	const hopperLow = hopperIsLow(hopperLevelPercent, orgSettings.settings.hopperLowPct);

	// #819: one ordered list for the sidebar. Every kind owns a real destination
	// (see lib/dashboard/alerts.ts), so the dashboard body no longer grows a
	// banner or a rail card above the fold.
	const alerts = buildDashboardAlerts(
		{
			deviceId: energyDevice?.id ?? null,
			deviceName: device.name,
			isOffline: esp32Offline,
			hopperLevelPercent,
			hopperLow,
			rtcOk: energyDevice?.rtcOk ?? null,
			pendingCommandCount,
			recalibration,
			drift,
			offlineDuration: energyDevice ? formatOfflineDuration(energyDevice.lastSeenAt) : "",
		},
		t,
	);
	// The health card's action and a health alert with no device would be the
	// same generic page, so only a real feeder gets a destination.
	const hardwareHref = energyDevice
		? deviceSettingsHref({ deviceId: energyDevice.id, anchor: "device-status" })
		: null;
	// The mobile banner and the sidebar row share one destination (#819).
	const offlineAlert = alerts.find((alert) => alert.id === "offline");
	// A healthy unit renders no health card at all, so the mobile card is only a
	// link when there is something to fix.
	const healthNeedsAction = deviceHealthNeedsAction(deviceHealth);

	const advisorReasoning = initialPrediction.reasoning || null;
	const pondMeta = [
		{
			label: t("populationLabel"),
			value: livePopulation !== null ? t("populationValue", { count: livePopulation }) : "—",
		},
		{
			label: t("mortalityLabel"),
			value:
				mortalityPct !== null
					? t("mortalityValue", { dead: liveCount.dead, pct: mortalityPctLabel })
					: "—",
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
			{energyDevice && hopperLevelPercent !== null && hopperLow && (
				<PakoyLowHopper pondId={pond.id} levelPercent={Math.round(hopperLevelPercent)} low />
			)}

			{/* The desktop surface is the right rail's alerts section; the page
			    keeps a top-of-page health card for the stacked phone/tablet
			    layout, and the card itself links to the hardware page where it
			    is fixed (#892). */}
			{energyDevice && healthNeedsAction && (
				<div className="xl:hidden">
					{hardwareHref ? (
						<Link
							href={hardwareHref}
							className="block rounded-2xl focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]"
						>
							<HealthNotice health={deviceHealth} tone="themed" />
							<span className="mt-1 inline-flex min-h-8 items-center gap-1 text-[11px] font-black text-[#C2410C] dark:text-[#ff8a5c]">
								{t("controlRoom.alerts.openHardware")}{" "}
								<ArrowRight aria-hidden="true" className="h-3 w-3" />
							</span>
						</Link>
					) : (
						<HealthNotice health={deviceHealth} tone="themed" />
					)}
				</div>
			)}

			<ControlRoomLayout>
				{/* #880: a band like every other stacked section, with the alert as a
				    rounded card inside it. As a full-bleed red strip the card bled
				    past the page gutter on a phone and read as a clipped slab. */}
				{offlineAlert && (
					<section
						role="alert"
						className={cn(CONTROL_ROOM_ORDER.alert, "lg:hidden", CONTROL_ROOM_MOBILE_BAND)}
					>
						<div className="rounded-2xl bg-[#C42B3A] px-4 py-3 text-white shadow-lg max-lg:shadow-none">
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
									href={offlineAlert.href}
									className="flex min-h-11 items-center justify-center rounded-2xl bg-white px-4 text-sm font-black text-[#C42B3A] transition hover:bg-white/90 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
								>
									{offlineAlert.linkLabel}
								</Link>
							</div>
						</div>
					</section>
				)}

				<NextFeedingStrip
					className={cn(
						CONTROL_ROOM_ORDER.hero,
						CONTROL_ROOM_MAIN.hero,
						CONTROL_ROOM_MOBILE_BAND,
						"max-xl:bg-[#EAF1F6] max-xl:pt-5 dark:max-xl:bg-[#0b1a24]",
					)}
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
					className={cn(
						CONTROL_ROOM_ORDER.canvas,
						CONTROL_ROOM_MAIN.canvas,
						CONTROL_ROOM_MOBILE_BAND,
					)}
					pondName={pond.name}
					feeders={feeders}
				/>

				<div
					className={cn(
						CONTROL_ROOM_ORDER.charts,
						CONTROL_ROOM_MAIN.charts,
						"min-h-0 min-w-0",
						CONTROL_ROOM_MOBILE_BAND,
					)}
				>
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

					<div className="grid min-h-0 min-w-0 grid-cols-1 gap-3 max-xl:gap-0 lg:grid-cols-3">
						<LazyStackedBars
							className="ofd-chart-card min-w-0"
							plotClassName="ofd-plot"
							title={t("controlRoom.charts.feedTitle")}
							summary={t("controlRoom.charts.feedSummary", {
								total: formatChartNumber(feedChartTotal, "g"),
							})}
							labels={chartLabels}
							stack={feedChart.stack}
							seriesLabels={sourceSeriesLabels}
							unit="g"
							height="100%"
						/>
						<LazyLineTrend
							className="ofd-chart-card min-w-0"
							plotClassName="ofd-plot"
							title={t("controlRoom.charts.hopperTitle")}
							summary={t("controlRoom.charts.hopperSummary", {
								latest: hopperLatest ?? "—",
							})}
							labels={{ ...chartLabels, empty: t("controlRoom.charts.hopperEmpty") }}
							points={hopperPoints}
							unit="%"
							decimals={0}
							height="100%"
						/>
						<LazyLineTrend
							className="ofd-chart-card min-w-0"
							plotClassName="ofd-plot"
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
							height="100%"
						/>
					</div>
				</div>

				<ControlRoomRail label={t("controlRoom.railLabel")}>
					{/* #892: the actionable alerts are a dedicated section at the top
					    of the right pane, each one a real link to its remedy. The
					    left sidebar keeps only the hopper reading and the ESP32
					    connection state. Below `xl` the rail is `display: contents`,
					    so the same section stacks at its mobile order. */}
					<div
						data-testid="dashboard-alerts"
						className={cn(CONTROL_ROOM_ORDER.alerts, CONTROL_ROOM_MOBILE_BAND)}
					>
						<ControlPanel title={t("controlRoom.alertsPanel")} icon={AlertTriangle}>
							{energyDevice && healthNeedsAction ? (
								// The desktop copy of the health notice lives here; the
								// page-level card above covers everything below `xl`, so
								// the two never show at the same time.
								<div className="mb-3 hidden xl:block">
									{hardwareHref ? (
										<Link
											href={hardwareHref}
											className="block rounded-2xl focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]"
										>
											<HealthNotice health={deviceHealth} tone="themed" />
											<span className="inline-flex min-h-8 items-center gap-1 text-[11px] font-black text-[#C2410C] dark:text-[#ff8a5c]">
												{t("controlRoom.alerts.openHardware")}{" "}
												<ArrowRight aria-hidden="true" className="h-3 w-3" />
											</span>
										</Link>
									) : (
										<HealthNotice health={deviceHealth} tone="themed" />
									)}
								</div>
							) : null}
							<AlertsPanel
								items={alerts}
								emptyTitle={t("controlRoom.alerts.emptyTitle")}
								emptyDescription={t("controlRoom.alerts.emptyDetail")}
							/>
						</ControlPanel>
					</div>

					<div className={cn(CONTROL_ROOM_ORDER.header, CONTROL_ROOM_MOBILE_BAND)}>
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

					<div className={cn(CONTROL_ROOM_ORDER.pond, CONTROL_ROOM_MOBILE_BAND)}>
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
							"xl:rounded-2xl xl:border xl:border-gray-200 xl:bg-white xl:p-4 xl:shadow-sm dark:xl:border-gray-700/60 dark:xl:bg-gray-900",
							CONTROL_ROOM_MOBILE_BAND,
						)}
					>
						<FeedNowButton
							deviceId={energyDevice?.id ?? device.id}
							nextFeedingVolume={pond.isFallow ? "0g" : `${nextFeedingVolumeG}g`}
							label={tBtn("feedNow")}
							deviceName={energyDevice?.label ?? device.name}
							connectionStatus={connection.state}
							rssiDbm={hopper?.rssiDbm ?? null}
							hopperLevelPct={hopper?.levelPercent ?? null}
							canWrite={can.canControlFeeder}
							isFallow={pond.isFallow}
							gramsPerSecond={energyDevice?.gramsPerSecond}
							feedNowLimit={feedNowLimit}
							data-onboard="feed-now"
						/>
					</div>

					{energyDevice && (
						<div className={cn(CONTROL_ROOM_ORDER.device, CONTROL_ROOM_MOBILE_BAND)}>
							<FeedLevelCard
								levelPercent={hopper?.levelPercent ?? null}
								updatedAt={hopper?.levelUpdatedAt ?? null}
								hopperCapacityG={hopper?.hopperCapacityG ?? null}
								gramsPerFeeding={energyDevice.gramsPerFeeding}
								feedsPerDay={feedsPerDay}
								isDeviceOffline={hopper?.isOffline ?? esp32Offline}
								isSensorOffline={hopper?.sensorOffline ?? false}
							/>
						</div>
					)}

					{energyDevice && (
						<div className={cn(CONTROL_ROOM_ORDER.water, CONTROL_ROOM_MOBILE_BAND)}>
							{
								// Resolved here rather than as JSX: the card translates on the
								// server, and a static render has no Suspense boundary to catch a
								// suspended async component.
								await WaterTempCard({
									// #622: ingest stores the firmware's already-offset
									// reading; adding the offset here showed it twice.
									tempC: energyDevice.waterTempC,
									tempOk: energyDevice.waterTempOk,
									updatedAt: energyDevice.waterTempUpdatedAt,
									isDeviceOffline: esp32Offline,
									minFeedTempC: energyDevice.minFeedTempC,
								})
							}
						</div>
					)}

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
					<div
						className={cn(CONTROL_ROOM_ORDER.advisorFull, "xl:hidden", CONTROL_ROOM_MOBILE_BAND)}
					>
						{pond.isFallow ? (
							<div className="flex flex-col gap-4 rounded-3xl border border-dashed border-[#0A3D62]/20 bg-white p-6 dark:border-white/10 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between max-xl:rounded-none max-xl:border-0 max-xl:bg-transparent max-xl:p-0">
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
						<div className={cn(CONTROL_ROOM_ORDER.growOut, CONTROL_ROOM_MOBILE_BAND)}>
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

					<div
						data-help="dashboard-feed-log"
						className={cn(CONTROL_ROOM_ORDER.feedings, CONTROL_ROOM_MOBILE_BAND)}
					>
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
						<div
							data-help="dashboard-biomass-log"
							className={cn(CONTROL_ROOM_ORDER.biomass, CONTROL_ROOM_MOBILE_BAND)}
						>
							<ControlPanel title={t("biomassLogsTitle")} icon={Layers}>
								<ul className="space-y-1.5 max-xl:space-y-0">
									{recentBiomassLogs.slice(0, 3).map((log) => (
										<li
											key={log.id}
											className="flex items-center justify-between gap-2 rounded-xl bg-[#F7F9F8] px-2.5 py-1.5 dark:bg-gray-800/60 max-xl:min-h-11 max-xl:rounded-none max-xl:border-b max-xl:border-[#E6ECE9] max-xl:bg-transparent max-xl:px-0 max-xl:py-3 dark:max-xl:border-gray-800"
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

					<div className={cn(CONTROL_ROOM_ORDER.stats, CONTROL_ROOM_MOBILE_BAND)}>
						<ControlPanel title={t("controlRoom.statsPanel")} icon={TrendingUp}>
							<div className="grid grid-cols-2 gap-2 max-xl:grid-cols-1 max-xl:gap-0">
								<div data-help="fcr" data-onboard="fcr">
									<StatTile
										label={
											<TermInfo
												label={t("currentFcrLabel")}
												hint={tCommon("terminology.aboutFcr")}
												description={tCommon("terminology.fcr")}
											/>
										}
										value={latestFcr === null ? "—" : latestFcr.toFixed(2)}
										detail={fcrTileDetail}
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
									value={
										livePopulation !== null ? t("populationValue", { count: livePopulation }) : "—"
									}
									detail={
										mortalityPct !== null
											? t("populationDetail", {
													stocked: liveCount.stocked ?? 0,
													dead: liveCount.dead,
													pct: mortalityPct.toFixed(1),
												})
											: t("populationStable")
									}
									icon={Layers}
									href="/dashboard/growth"
								/>
							</div>
						</ControlPanel>
					</div>

					{energyDevice && (
						<div
							className={cn(
								CONTROL_ROOM_ORDER.controller,
								"min-w-0 space-y-3",
								CONTROL_ROOM_MOBILE_BAND,
								"max-xl:space-y-4",
							)}
						>
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
									canWrite={can.canControlFeeder}
									isFallow={pond.isFallow}
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
