import { EnergyControllerCard } from "@/components/EnergyControllerCard";
import { FeedLevelCard } from "@/components/FeedLevelCard";
import { FeedNowButton } from "@/components/FeedNowButton";
import { FeedingPredictionCard } from "@/components/FeedingPredictionCard";
import { TimeCalibrationForm } from "@/components/TimeCalibrationForm";
import { WaterTempCard } from "@/components/WaterTempCard";
import { ExportPdfButton } from "@/components/export-pdf-button";
import { Link } from "@/i18n/routing";
import { canWrite } from "@/lib/auth/session";
import { DEFAULT_FISH_COUNT, OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { todayDateOnly } from "@/lib/crop-cycle/dates";
import { toPredictionCycleContext } from "@/lib/crop-cycle/prediction-context";
import { formatDateTimeLocal } from "@/lib/date-local";
import { feedPerMealG, totalBiomassG } from "@/lib/feed-calc";
import { getActivePond } from "@/lib/pond-selection";
import { computeDeterministicPrediction } from "@/lib/prediction";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import {
	Activity,
	Calendar,
	ChevronRight,
	Layers,
	Sliders,
	Sparkles,
	TrendingUp,
	Wheat,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0; // Ensure data is always fresh

export default async function DashboardHomePage() {
	const [t, tBtn, tHist, tGrowth, tHarvest, tDates, writeAccess, pond] = await Promise.all([
		getTranslations("dashboard.home"),
		getTranslations("button"),
		getTranslations("dashboard.history"),
		getTranslations("dashboard.growth"),
		getTranslations("dashboard.harvest.summary"),
		getTranslations("dates"),
		canWrite(),
		getActivePond({ devices: true }),
	]);

	if (!pond || !pond.devices.length) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500 dark:text-gray-400">{t("noData")}</p>
			</div>
		);
	}

	const device = pond.devices[0];

	// One parallel wave for independent reads. The recent biomass rows are the
	// source of the latest sample too, so there is no duplicate findFirst.
	const [energyDevice, recentBiomassLogs, fcrReports, activeCycle] = await Promise.all([
		prisma.energyDevice.findFirst({
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
	]);

	const latestBiomass = recentBiomassLogs[0] ?? null;

	// Schedule resolution needs the device id; feeding history needs the same
	// id, so they share the second wave.
	const [currentConfig, feedingHistory] = await Promise.all([
		resolveCurrentSchedule(pond.id, energyDevice?.id ?? null),
		energyDevice
			? prisma.feedEvent.findMany({
					where: { deviceId: energyDevice.id, eventType: "feed_dispensed" },
					orderBy: { receivedAt: "desc" },
					take: 5,
				})
			: Promise.resolve([]),
	]);

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const latestFcr = fcrReports.length > 0 ? fcrReports[fcrReports.length - 1].fcrValue : 0.0;
	const cycleContext = activeCycle ? toPredictionCycleContext(activeCycle, todayDateOnly()) : null;

	// The advisor is surfaced on the home page so it is not hidden behind the
	// Growth tab. The server renders the deterministic value instantly; the
	// client card refines it with the AI provider in the background.
	const initialPrediction = computeDeterministicPrediction({
		feedingRatePct: currentConfig?.feedingRatePct ?? pond.feedingRatePct,
		feedsPerDay: currentConfig?.feedsPerDay ?? pond.feedsPerDay,
		population: pond.population ?? DEFAULT_FISH_COUNT,
		avgWeightKg: latestBiomass?.avgWeightKg ?? null,
		latestFcr: fcrReports.length > 0 ? latestFcr : null,
		currentGrams: energyDevice?.gramsPerFeeding ?? null,
		hopperCapacityG: energyDevice?.hopperCapacityG ?? null,
		lastSampleAt: latestBiomass?.recordedAt ?? null,
		isFallow: pond.isFallow,
		cycle: cycleContext,
	});

	// Calculate next feeding time
	const now = new Date();
	const startHour = (currentConfig?.scheduleStart ?? pond.scheduleStart).getUTCHours();
	const endHour = (currentConfig?.scheduleEnd ?? pond.scheduleEnd).getUTCHours();
	const feedsPerDay = currentConfig?.feedsPerDay ?? pond.feedsPerDay;
	const feedingRatePct = currentConfig?.feedingRatePct ?? pond.feedingRatePct;
	const feedInterval = (endHour - startHour) / Math.max(1, feedsPerDay - 1);

	let nextFeedTimeObj = null;
	for (let i = 0; i < feedsPerDay; i++) {
		const feedTime = new Date();
		feedTime.setHours(startHour + i * feedInterval, 0, 0, 0);
		if (feedTime > now) {
			nextFeedTimeObj = feedTime;
			break;
		}
	}
	if (!nextFeedTimeObj) {
		nextFeedTimeObj = new Date();
		nextFeedTimeObj.setDate(nextFeedTimeObj.getDate() + 1);
		nextFeedTimeObj.setHours(startHour, 0, 0, 0);
	}

	const formatTime = (d: Date) => formatDateTimeLocal(d, tDates).time;
	const formatDate = (d: Date) => formatDateTimeLocal(d, tDates).date;

	const nextFeedingTimeStr = formatTime(nextFeedTimeObj);

	// Daily Feed (g) = Total Biomass (g) × Feeding Rate (%)
	// Feed per Meal (g) = Daily Feed (g) ÷ Feeds Per Day  (see lib/feed-calc.ts)
	const pondPopulation = pond.population;
	let nextFeedingVolumeG = energyDevice?.gramsPerFeeding ?? 330;
	if (latestBiomass) {
		nextFeedingVolumeG = feedPerMealG(
			totalBiomassG(pondPopulation, latestBiomass.avgWeightKg),
			feedingRatePct,
			feedsPerDay,
		);
	}

	// Calculate days until next physical weighing (assuming every 14 days)
	const daysSinceSample = latestBiomass
		? Math.floor((now.getTime() - latestBiomass.recordedAt.getTime()) / (1000 * 60 * 60 * 24))
		: 0;
	const daysUntilSample = Math.max(0, (pond.sampleIntervalDays ?? 14) - daysSinceSample);

	// Determine Critical Alert — lazy offline detection from energyDevice.lastSeenAt
	const esp32Offline =
		!energyDevice?.lastSeenAt ||
		now.getTime() - energyDevice.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS;
	const criticalAlert = esp32Offline && !!energyDevice;
	const isPaused = energyDevice?.isPaused ?? false;

	function formatOfflineDuration(lastSeenAt: Date | null): string {
		if (!lastSeenAt) return "not connected";
		const ms = now.getTime() - lastSeenAt.getTime();
		const totalMinutes = Math.floor(ms / 60000);
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		if (hours > 24) {
			const days = Math.floor(hours / 24);
			const remainHours = hours % 24;
			return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
		}
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	}

	return (
		<div className="space-y-6 pb-20 animate-in fade-in duration-150" data-onboard="welcome">
			{criticalAlert && (
				<section className="sticky top-16 z-20 -mx-4 -mt-4 rounded-none bg-[#C42B3A] px-4 py-3 text-white shadow-lg md:mx-0 md:mt-0 md:rounded-[24px] md:px-5">
					<div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex items-start gap-3">
							<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/15 font-black">
								!
							</div>
							<div>
								<p className="text-sm font-black md:text-base">
									Device offline for {formatOfflineDuration(energyDevice?.lastSeenAt ?? null)}
								</p>
								<p className="text-xs font-semibold text-white/80">
									ESP32 node {device.name} missed the latest sync handshake.
								</p>
							</div>
						</div>
						<Link
							href="/dashboard/settings"
							className="min-h-11 rounded-2xl bg-white px-4 text-sm font-black text-[#C42B3A] transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#C42B3A] flex items-center justify-center"
						>
							View Details
						</Link>
					</div>
				</section>
			)}

			{/* Welcome row */}
			<div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
				<div>
					<h1 className="text-2xl md:text-3xl font-black text-[#0A3D62] dark:text-[#5b9bd5] tracking-tight flex items-center gap-2">
						Welcome Back! <Sparkles className="w-6 h-6 text-[#E85A2A] dark:text-[#ff8a5c]" />
					</h1>
					<p className="text-[#3D5568] dark:text-gray-400 text-xs md:text-sm mt-0.5">
						Monitoring <strong>{pond.name}</strong> remotely from <strong>Western Visayas</strong>{" "}
						node.
					</p>
				</div>

				<FeedNowButton
					deviceId={energyDevice?.id ?? device.id}
					nextFeedingVolume={pond.isFallow ? "0g" : `${nextFeedingVolumeG}g`}
					label={tBtn("feedNow")}
					deviceName={energyDevice?.label ?? device.name}
					connectionStatus={esp32Offline ? "offline" : "online"}
					hopperLevelPct={energyDevice?.feedLevelPercent ?? 0}
					canWrite={writeAccess}
					isFallow={pond.isFallow}
					gramsPerSecond={energyDevice?.gramsPerSecond}
					data-onboard="feed-now"
				/>
				<ExportPdfButton />
			</div>

			{/* AI Feed Advisor — visible on the first screen the operator sees. */}
			{pond.isFallow ? (
				<div className="flex flex-col gap-4 rounded-[32px] border border-dashed border-[#0A3D62]/20 bg-white p-6 dark:border-white/10 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-start gap-3">
						<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]">
							<Wheat className="h-6 w-6" />
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
						href="/dashboard/harvest"
						className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#164e7c] dark:bg-[#1f66a0]"
					>
						{tHarvest("startCycle")} <ChevronRight className="h-4 w-4" />
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

			{/* Grow-out & harvest strip */}
			{activeCycle && cycleContext && (
				<div className="flex flex-col gap-3 rounded-2xl border border-[#0A3D62]/10 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-2.5">
						<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]">
							<Wheat className="h-5 w-5" />
						</div>
						<div>
							<p className="text-xs font-black text-[#0A3D62] dark:text-[#5b9bd5]">
								{activeCycle.label || tHarvest("cycle")}
							</p>
							<p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
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
									? ` · ${activeCycle.targetHarvestWeightG} g target`
									: ""}
							</p>
						</div>
					</div>
					<Link
						href="/dashboard/harvest"
						className="inline-flex items-center gap-1 text-xs font-bold text-[#0A3D62] hover:underline dark:text-[#5b9bd5]"
					>
						{tHarvest("progress")} <ChevronRight className="h-3.5 w-3.5" />
					</Link>
				</div>
			)}

			{/* Bento Grid — items-start keeps each tile at its natural height */}
			<div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
				{/* Tile 1: Hero — next feeding time (8 cols) */}
				<div
					className="col-span-1 md:col-span-8 bg-white dark:bg-gray-900 rounded-[32px] p-6 md:p-8 shadow-md border border-[#0A3D62]/5 dark:border-gray-700/50 flex flex-col justify-between min-h-[300px] relative overflow-hidden"
					data-onboard="next-feeding"
				>
					<div className="absolute top-0 right-0 w-32 h-32 bg-[#0A3D62]/5 dark:bg-[#5b9bd5]/10 rounded-full translate-x-12 -translate-y-12" />

					<div>
						<div className="flex items-center gap-2.5">
							<span className="text-[#3D5568] dark:text-gray-400 text-xs font-bold uppercase tracking-[0.2em]">
								{t("nextFeedingLabel")}
							</span>
							<span
								className={`w-2.5 h-2.5 rounded-full ${
									isPaused ? "bg-[#C42B3A]" : "bg-[#1E7B34] animate-pulse"
								}`}
							/>
						</div>

						<div className="text-6xl md:text-8xl font-black text-[#0A3D62] dark:text-[#5b9bd5] tracking-tighter my-4">
							{isPaused ? "—:—" : nextFeedingTimeStr}
						</div>

						<div className="flex flex-wrap items-center gap-3">
							<span
								className={`px-4 py-1.5 rounded-full font-bold text-xs border ${
									isPaused
										? "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-[#C42B3A] dark:text-red-400"
										: "bg-[#1E7B34]/10 dark:bg-green-900/30 border-[#1E7B34]/20 dark:border-green-800 text-[#1E7B34] dark:text-green-400"
								}`}
							>
								{isPaused ? t("schedulePaused") : t("timerOn")}
							</span>
							<span className="text-[#3D5568] dark:text-gray-400 text-xs font-medium">
								{latestBiomass
									? t("basedOnLog", { date: formatDate(latestBiomass.recordedAt) })
									: t("na")}
							</span>
						</div>
					</div>

					<div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 pt-6 border-t border-gray-100 dark:border-gray-700 mt-6">
						<div className="flex gap-8">
							<div>
								<p className="text-[#3D5568] dark:text-gray-400 text-[10px] font-bold uppercase tracking-wider">
									{t("feedVolumeLabel")}
								</p>
								<p className="text-2xl md:text-3xl font-black text-[#E85A2A] dark:text-[#ff8a5c]">
									{pond.isFallow ? "—" : `${nextFeedingVolumeG}g`}
								</p>
							</div>
							<div>
								<p className="text-[#3D5568] dark:text-gray-400 text-[10px] font-bold uppercase tracking-wider">
									{t("feedRateLabel")}
								</p>
								<p className="text-2xl md:text-3xl font-black dark:text-white">
									{feedingRatePct}
									{t("feedRateSuffix")}
								</p>
							</div>
						</div>

						<Link
							href="/dashboard/log-sample"
							className="bg-[#0A3D62] dark:bg-[#5b9bd5] hover:bg-[#12588c] dark:hover:bg-[#7dbbea] text-white px-5 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 self-stretch sm:self-auto justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
						>
							{tBtn("updateBiomass")} <ChevronRight className="w-4 h-4" />
						</Link>
					</div>
				</div>

				{/* Tile 2: FCR (4 cols) */}
				<Link
					href="/dashboard/growth"
					className="col-span-1 md:col-span-4 bg-[#0A3D62] rounded-[32px] p-6 md:p-8 text-white flex flex-col justify-between min-h-[300px] relative overflow-hidden shadow-md hover:bg-[#0d4a76] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
					data-onboard="fcr"
				>
					<div className="absolute bottom-0 right-0 w-32 h-32 bg-white/5 rounded-full translate-x-8 translate-y-8" />
					<div className="flex justify-between items-start">
						<div>
							<p className="text-xs font-extrabold uppercase tracking-widest text-white/60">
								{t("currentFcrLabel")}
							</p>
							<span className="text-[10px] font-mono bg-white/10 px-2 py-0.5 rounded-full mt-1 inline-block">
								{t("fcrTag")}
							</span>
						</div>
						<div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
							<TrendingUp className="w-6 h-6 text-green-400" />
						</div>
					</div>

					<div className="my-4">
						<h2 className="text-5xl md:text-6xl font-black text-white tracking-tight">
							{fcrReports.length > 0 ? latestFcr.toFixed(2) : "—"}
						</h2>
						{fcrReports.length > 0 && (
							<p className="text-xs text-white/70 mt-1.5 font-medium">{t("fcrOptimal")}</p>
						)}
					</div>

					{/* Mini sparkline SVG */}
					<div className="h-16 w-full mt-4 bg-white/5 p-2 rounded-xl border border-white/10">
						<svg
							className="w-full h-full"
							viewBox="0 0 100 40"
							preserveAspectRatio="none"
							role="img"
							aria-label="Growth trend"
						>
							<path
								d="M0 35 L 25 31 L 50 20 L 75 14 L 100 5"
								fill="none"
								stroke="#10b981"
								strokeWidth="3.5"
								strokeLinecap="round"
							/>
						</svg>
					</div>
				</Link>

				{/* Tile 3: Days until sample (4 cols) */}
				<div className="col-span-1 md:col-span-4 bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-[#0A3D62]/5 dark:border-gray-700/50 flex items-center gap-5">
					<div className="w-14 h-14 bg-amber-50 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center shrink-0">
						<Calendar className="w-7 h-7 text-amber-600 dark:text-amber-400" />
					</div>
					<div>
						<p className="text-[10px] font-extrabold uppercase text-[#3D5568] dark:text-gray-400 tracking-wider">
							{t("weighingDue")}
						</p>
						<p className="text-lg md:text-xl font-black text-[#0A3D62] dark:text-[#5b9bd5]">
							{t("days", { count: daysUntilSample })}
						</p>
						<Link
							href="/dashboard/log-sample"
							className="text-xs text-[#E85A2A] dark:text-[#ff8a5c] font-extrabold hover:underline flex items-center gap-0.5 mt-0.5 focus-visible:outline-none"
						>
							{tBtn("scheduleSampling")} <ChevronRight className="w-3 h-3" />
						</Link>
					</div>
				</div>

				{/* Tile 4: Last biomass weight (4 cols) */}
				<div className="col-span-1 md:col-span-4 bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-[#0A3D62]/5 dark:border-gray-700/50 flex items-center gap-5">
					<div className="w-14 h-14 bg-blue-50 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center shrink-0">
						<Sliders className="w-7 h-7 text-[#0A3D62] dark:text-[#5b9bd5]" />
					</div>
					<div className="flex-1">
						<p className="text-[10px] font-extrabold uppercase text-[#3D5568] dark:text-gray-400 tracking-wider">
							{t("lastBiomassLabel")}
						</p>
						<p className="text-lg md:text-xl font-black text-[#0A3D62] dark:text-[#5b9bd5]">
							{latestBiomass ? `${latestBiomass.avgWeightKg * 1000}g` : t("na")}
						</p>
						<p className="text-[10px] text-[#3D5568] dark:text-gray-500">
							{t("lastBiomassBased", { count: latestBiomass?.sampleCount ?? 0 })}
						</p>
					</div>
				</div>

				{/* Tile 5: Pond population (4 cols) */}
				<div className="col-span-1 md:col-span-4 bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-[#0A3D62]/5 dark:border-gray-700/50 flex items-center gap-5">
					<div className="w-14 h-14 bg-green-50 dark:bg-green-900/30 rounded-2xl flex items-center justify-center shrink-0">
						<Layers className="w-7 h-7 text-green-700 dark:text-green-400" />
					</div>
					<div>
						<p className="text-[10px] font-extrabold uppercase text-[#3D5568] dark:text-gray-400 tracking-wider">
							{t("populationLabel")}
						</p>
						<p className="text-lg md:text-xl font-black text-[#0A3D62] dark:text-[#5b9bd5]">
							{t("populationValue", { count: pond.population ?? DEFAULT_FISH_COUNT })}
						</p>
						<span className="text-[10px] text-[#3D5568] dark:text-gray-500 font-mono">
							{t("populationStable")}
						</span>
					</div>
				</div>

				{/* Tile 6: Recent feeding logs (12 cols) */}
				<div className="col-span-1 md:col-span-12 bg-white dark:bg-gray-900 rounded-[32px] p-6 md:p-8 shadow-md border border-[#0A3D62]/5 dark:border-gray-700/50">
					<div className="flex justify-between items-center mb-6">
						<div>
							<h3 className="text-lg md:text-xl font-black uppercase tracking-tight text-[#0A3D62] dark:text-[#5b9bd5]">
								{t("feedingLogsTitle")}
							</h3>
							<p className="text-xs text-[#3D5568] dark:text-gray-400">{t("feedingLogsDesc")}</p>
						</div>
						<Link
							href="/dashboard/history"
							className="text-[#0A3D62] dark:text-[#5b9bd5] font-extrabold text-sm hover:underline focus-visible:outline-none"
						>
							{tBtn("viewHistory")}
						</Link>
					</div>

					{feedingHistory.length === 0 ? (
						<p className="py-8 text-center text-sm text-[#3D5568] dark:text-gray-400">
							{t("noFeedings")}
						</p>
					) : (
						<div className="space-y-3">
							{feedingHistory.map((item, idx) => (
								<div
									key={item.id}
									className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-[#F4F7F6] dark:bg-gray-800 rounded-2xl border border-[#0A3D62]/5 dark:border-gray-700/50 gap-4"
								>
									<div className="flex items-center gap-4">
										<div className="w-10 h-10 bg-white dark:bg-gray-700 rounded-xl flex items-center justify-center font-extrabold text-xs text-[#0A3D62] dark:text-[#5b9bd5] border border-gray-200 dark:border-gray-600 shrink-0">
											0{idx + 1}
										</div>
										<div>
											<div className="flex items-center gap-2">
												<p className="font-extrabold text-base text-[#0A3D62] dark:text-[#5b9bd5]">
													{formatTime(item.receivedAt)}
												</p>
												<span className="text-[10px] text-[#3D5568] dark:text-gray-400 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 px-1.5 py-0.5 rounded-full font-mono">
													{formatDate(item.receivedAt)}
												</span>
											</div>
											<p className="text-xs text-[#3D5568] dark:text-gray-400">
												{tHist(item.source ? `source_${item.source}` : "confirmedDispense")}
											</p>
										</div>
									</div>
									<div className="flex items-center justify-between sm:justify-end gap-6 border-t sm:border-t-0 pt-2 sm:pt-0 border-gray-200 dark:border-gray-700">
										<div className="text-left sm:text-right">
											<p className="font-extrabold text-base text-[#0A3D62] dark:text-[#5b9bd5]">
												{item.grams ?? 0}g
											</p>
											<p className="text-[10px] font-bold uppercase text-[#3D5568] dark:text-gray-500 opacity-50">
												{tHist("amount")}
											</p>
										</div>
										<span className="px-4 py-1.5 rounded-full font-bold text-xs text-center min-w-[80px] shadow-sm bg-[#1E7B34] dark:bg-green-800 text-white">
											{tHist("confirmedDispense")}
										</span>
									</div>
								</div>
							))}
						</div>
					)}
				</div>

				{/* Tile 7: Recent biomass logs (12 cols) */}
				{recentBiomassLogs.length > 0 && (
					<div className="col-span-1 md:col-span-12 bg-white dark:bg-gray-900 rounded-[32px] p-6 md:p-8 shadow-md border border-[#0A3D62]/5 dark:border-gray-700/50">
						<div className="flex justify-between items-center mb-6">
							<div>
								<h3 className="text-lg md:text-xl font-black uppercase tracking-tight text-[#0A3D62] dark:text-[#5b9bd5]">
									{t("biomassLogsTitle")}
								</h3>
								<p className="text-xs text-[#3D5568] dark:text-gray-400">{t("biomassLogsDesc")}</p>
							</div>
							<Link
								href="/dashboard/growth"
								className="text-[#0A3D62] dark:text-[#5b9bd5] font-extrabold text-sm hover:underline focus-visible:outline-none"
							>
								{t("viewGrowth")}
							</Link>
						</div>
						<div className="space-y-3">
							{recentBiomassLogs.map((log, idx) => (
								<div
									key={log.id}
									className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-[#F4F7F6] dark:bg-gray-800 rounded-2xl border border-[#0A3D62]/5 dark:border-gray-700/50 gap-4"
								>
									<div className="flex items-center gap-4">
										<div className="w-10 h-10 bg-white dark:bg-gray-700 rounded-xl flex items-center justify-center font-extrabold text-xs text-[#0A3D62] dark:text-[#5b9bd5] border border-gray-200 dark:border-gray-600 shrink-0">
											0{idx + 1}
										</div>
										<div>
											<div className="flex items-center gap-2 flex-wrap">
												<p className="font-extrabold text-base text-[#0A3D62] dark:text-[#5b9bd5]">
													{formatDate(log.recordedAt)}
												</p>
												{log.batchLabel && (
													<span className="text-[10px] text-[#3D5568] dark:text-gray-400 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 px-1.5 py-0.5 rounded-full font-mono">
														{log.batchLabel}
													</span>
												)}
												{log.source === "import" && (
													<span className="text-[10px] font-bold text-violet-700 bg-violet-100 dark:bg-violet-900/40 dark:text-violet-300 px-1.5 py-0.5 rounded-full">
														{tGrowth("importedBadge")}
													</span>
												)}
											</div>
											<p className="text-xs text-[#3D5568] dark:text-gray-400">
												{log.fishSamples.length > 0
													? `${log.fishSamples.length} fish`
													: `Avg • ${log.sampleCount} samples`}
											</p>
										</div>
									</div>
									<div className="flex items-center justify-between sm:justify-end gap-6 border-t sm:border-t-0 pt-2 sm:pt-0 border-gray-200 dark:border-gray-700">
										<div className="text-left sm:text-right">
											<p className="font-extrabold text-base text-[#0A3D62] dark:text-[#5b9bd5]">
												{(log.avgWeightKg * 1000).toFixed(1)}g
											</p>
											<p className="text-[10px] font-bold uppercase text-[#3D5568] dark:text-gray-500 opacity-50">
												{tGrowth("abwCol")}
											</p>
										</div>
										<div className="text-left sm:text-right">
											<p className="font-extrabold text-base text-[#0A3D62] dark:text-[#5b9bd5]">
												{log.sampleWeightKg.toFixed(2)}kg
											</p>
											<p className="text-[10px] font-bold uppercase text-[#3D5568] dark:text-gray-500 opacity-50">
												Total
											</p>
										</div>
									</div>
								</div>
							))}
						</div>
					</div>
				)}
			</div>

			{energyDevice && (
				<section className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-5xl items-start">
					<FeedLevelCard
						levelPercent={energyDevice.feedLevelPercent}
						updatedAt={energyDevice.feedLevelUpdatedAt}
						hopperCapacityG={energyDevice.hopperCapacityG}
						gramsPerFeeding={energyDevice.gramsPerFeeding}
						feedsPerDay={pond.feedsPerDay}
						isDeviceOffline={esp32Offline}
					/>
					<WaterTempCard
						tempC={energyDevice.waterTempC}
						tempOk={energyDevice.waterTempOk}
						updatedAt={energyDevice.waterTempUpdatedAt}
						isDeviceOffline={esp32Offline}
					/>
					<div className="md:col-span-2">
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
						/>
					</div>
					<div className="md:col-span-2">
						<TimeCalibrationForm deviceId={energyDevice.id} canWrite={writeAccess} />
					</div>
				</section>
			)}
		</div>
	);
}
