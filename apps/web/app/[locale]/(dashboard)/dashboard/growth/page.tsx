import { DataExportButton, DataImportDialog } from "@/components/DataImportExport";
import { FcrCalculator } from "@/components/FcrCalculator";
import { FeedingPredictionCard } from "@/components/FeedingPredictionCard";
import {
	DashboardCard,
	DashboardCardList,
	DashboardCardRow,
	DashboardTHead,
	DashboardTable,
	DashboardTd,
	DashboardTh,
	DashboardTr,
} from "@/components/dashboard/dashboard-table";
import {
	DashboardEmptyState,
	DashboardPageHeader,
	DashboardSection,
	ReadOnlyNotice,
	dashboardSectionLink,
} from "@/components/dashboard/dashboard-ui";
import { GrowthPlanCard } from "@/components/growth/GrowthPlanCard";
import { SgrKpi, type SgrKpiLabels } from "@/components/growth/SgrKpi";
import { SnapshotWriter } from "@/components/pwa/snapshot-writer";
import { Link } from "@/i18n/routing";
import { canWrite } from "@/lib/auth/session";
import { DEFAULT_FISH_COUNT } from "@/lib/constants";
import { todayDateOnly } from "@/lib/crop-cycle/dates";
import { toPredictionCycleContext } from "@/lib/crop-cycle/prediction-context";
import { formatFarmDateTime } from "@/lib/date-local";
import { loadGrowthPlanForPond } from "@/lib/growth-plan-loader";
import type { GrowthSnapshotData } from "@/lib/offline/snapshots";
import { getActivePond } from "@/lib/pond-selection";
import { computeDeterministicPrediction } from "@/lib/prediction";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { averageDailyGain, overallSgr, sgrSeries, sgrUnavailableReason } from "@/lib/sgr";
import { Activity, ChevronRight, Fish, Package, Scale, TrendingUp, Wheat } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

const PREVIEW_ROWS = 5;
const GROWTH_PREVIEW_ROWS = 6;

export default async function GrowthPage() {
	const [t, tSch, tHarvest, tDates, tCommon, pond] = await Promise.all([
		getTranslations("dashboard.growth"),
		getTranslations("dashboard.schedule"),
		getTranslations("dashboard.harvest.summary"),
		getTranslations("dates"),
		getTranslations("dashboard.common"),
		getActivePond(),
	]);

	if (!pond) {
		return (
			<div className="mx-auto max-w-2xl py-10">
				<DashboardEmptyState
					icon={Fish}
					title={tSch("noPondData")}
					description={tSch("noDeviceDesc")}
				/>
			</div>
		);
	}

	// Bound the chart/table payloads: a decade of logs must not be serialized on
	// every visit. The history page remains the unbounded, paginated view.
	const [
		writeAccess,
		biomassDesc,
		earliestBiomass,
		fcrDesc,
		energyDevice,
		activeCycle,
		loadedPlan,
	] = await Promise.all([
		canWrite(),
		prisma.biomassLog.findMany({
			where: { pondId: pond.id },
			orderBy: { recordedAt: "desc" },
			take: 60,
			include: {
				fishSamples: { select: { id: true, weightGrams: true, lengthCm: true } },
			},
		}),
		// "Overall since the first sampling" must not be limited to the 60-row
		// chart window, so fetch only the oldest sample (bounded, pond-scoped).
		prisma.biomassLog.findFirst({
			where: { pondId: pond.id },
			orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
			select: { recordedAt: true, avgWeightKg: true },
		}),
		prisma.fcrReport.findMany({
			where: { pondId: pond.id },
			orderBy: { periodEnd: "desc" },
			take: 12,
		}),
		prisma.energyDevice.findFirst({
			where: { pondId: pond.id },
			orderBy: { createdAt: "asc" },
			select: { id: true, gramsPerFeeding: true, hopperCapacityG: true },
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
		loadGrowthPlanForPond(pond.id, { ownerId: pond.ownerId }),
	]);

	const biomassLogs = biomassDesc.slice().reverse();
	const fcrReports = fcrDesc.slice().reverse();

	// Newest first, with the period-over-period gains precomputed once. The
	// compact card and the growth-history page share the same calculation.
	const growthRows = biomassDesc.map((log, index) => {
		const previous = biomassDesc[index + 1] ?? null;
		const weightGain = previous ? log.avgWeightKg * 1000 - previous.avgWeightKg * 1000 : null;
		const lengthGain = previous ? log.sampleLengthCm - previous.sampleLengthCm : null;
		const daysSinceLast = previous
			? Math.round((log.recordedAt.getTime() - previous.recordedAt.getTime()) / 86_400_000)
			: null;
		return { log, weightGain, lengthGain, daysSinceLast };
	});

	// SGR (capstone objective). Biomass logs are already ascending for the chart,
	// so the series is oldest interval first and the last point is the latest one.
	const sgrSamples = biomassLogs.map((log) => ({
		recordedAt: log.recordedAt,
		avgWeightKg: log.avgWeightKg,
	}));
	const sgrPoints = sgrSeries(sgrSamples);
	const latestSgrPctPerDay = sgrPoints.at(-1)?.sgrPctPerDay ?? null;
	// Prefer the real first sampling for "overall"; fall back to the loaded set
	// (correct whenever the pond has 60 samples or fewer, which is the common case).
	const firstSgrSample = earliestBiomass
		? { recordedAt: earliestBiomass.recordedAt, avgWeightKg: earliestBiomass.avgWeightKg }
		: (sgrSamples[0] ?? null);
	const latestSgrSample = sgrSamples.at(-1) ?? null;
	const overallSgrSamples =
		sgrSamples.length >= 2 && firstSgrSample && latestSgrSample
			? [firstSgrSample, latestSgrSample]
			: sgrSamples;
	const overallSgrPctPerDay = overallSgr(overallSgrSamples);
	const sgrAverageDailyGainG = averageDailyGain(overallSgrSamples);
	const sgrReason = sgrUnavailableReason(overallSgrSamples);

	const cycleContext = activeCycle ? toPredictionCycleContext(activeCycle, todayDateOnly()) : null;

	// Deterministic prediction shown instantly; the client card refines it
	// with the AI provider in the background.
	const currentConfig = await resolveCurrentSchedule(pond.id, energyDevice?.id ?? null);
	const initialPrediction = computeDeterministicPrediction({
		feedingRatePct: currentConfig?.feedingRatePct ?? pond.feedingRatePct,
		feedsPerDay: currentConfig?.feedsPerDay ?? pond.feedsPerDay,
		population: pond.population ?? DEFAULT_FISH_COUNT,
		avgWeightKg: biomassLogs.length > 0 ? biomassLogs[biomassLogs.length - 1].avgWeightKg : null,
		latestFcr: fcrReports.length > 0 ? fcrReports[fcrReports.length - 1].fcrValue : null,
		currentGrams: energyDevice?.gramsPerFeeding ?? null,
		hopperCapacityG: energyDevice?.hopperCapacityG ?? null,
		lastSampleAt: biomassLogs.length > 0 ? biomassLogs[biomassLogs.length - 1].recordedAt : null,
		isFallow: pond.isFallow,
		cycle: cycleContext,
	});

	let feedLevelLogs: Awaited<ReturnType<typeof prisma.feedLevelLog.findMany>> = [];
	let feedLevelPreview: {
		id: string;
		recordedAt: Date;
		levelPercent: number;
		distanceCm: number;
	}[] = [];
	if (energyDevice) {
		const [recentLevels, preview] = await Promise.all([
			prisma.feedLevelLog.findMany({
				where: { deviceId: energyDevice.id },
				orderBy: { recordedAt: "desc" },
				take: 30,
			}),
			prisma.feedLevelLog.findMany({
				where: { deviceId: energyDevice.id },
				orderBy: { recordedAt: "desc" },
				take: PREVIEW_ROWS,
				select: { id: true, recordedAt: true, levelPercent: true, distanceCm: true },
			}),
		]);
		feedLevelLogs = recentLevels.slice().reverse();
		feedLevelPreview = preview;
	}

	const latestFcr = fcrReports.length > 0 ? fcrReports[fcrReports.length - 1].fcrValue : 0;
	const latestBiomass =
		biomassLogs.length > 0 ? biomassLogs[biomassLogs.length - 1].avgWeightKg : 0;
	const previousBiomass =
		biomassLogs.length > 1 ? biomassLogs[biomassLogs.length - 2].avgWeightKg : 0;

	const biomassGrowthPct =
		previousBiomass > 0 ? ((latestBiomass - previousBiomass) / previousBiomass) * 100 : 0;

	const formatDate = (d: Date) => formatFarmDateTime(d, tDates).date;

	// Custom SVG Line Chart generator for Biomass
	const maxBiomass = Math.max(...biomassLogs.map((l) => l.avgWeightKg), 0.01) * 1.1; // Add 10% padding top
	const minBiomass = Math.min(...biomassLogs.map((l) => l.avgWeightKg), 0);

	const generateBiomassPath = () => {
		if (biomassLogs.length < 2) return "";
		const w = 400;
		const h = 100;
		const points = biomassLogs.map((log, i) => {
			const x = (i / (biomassLogs.length - 1)) * w;
			const y = h - ((log.avgWeightKg - minBiomass) / (maxBiomass - minBiomass)) * h;
			return `${x},${y}`;
		});
		return `M ${points.join(" L ")}`;
	};

	// Feed level sparkline
	const maxLevel = Math.max(...feedLevelLogs.map((l) => l.levelPercent), 50);
	const minLevel = Math.min(...feedLevelLogs.map((l) => l.levelPercent), 0);

	const generateFeedLevelPath = () => {
		if (feedLevelLogs.length < 2) return "";
		const w = 400;
		const h = 100;
		const points = feedLevelLogs.map((log, i) => {
			const x = (i / (feedLevelLogs.length - 1)) * w;
			const y = h - ((log.levelPercent - minLevel) / (maxLevel - minLevel)) * h;
			return `${x},${y}`;
		});
		return `M ${points.join(" L ")}`;
	};

	const latestSample = biomassDesc[0] ?? null;
	const growthSnapshot: GrowthSnapshotData = {
		pondName: pond.name,
		latestAbwG: latestSample ? latestSample.avgWeightKg * 1000 : null,
		latestFcr: latestFcr > 0 ? latestFcr : null,
		latestSampleAt: latestSample?.recordedAt.toISOString() ?? null,
		cycleLabel: activeCycle?.label ?? null,
		targetWeightG: loadedPlan?.plan.targetWeightG ?? activeCycle?.targetHarvestWeightG ?? null,
		targetDate: loadedPlan?.plan.targetDate ?? null,
		track: loadedPlan?.plan.track ?? null,
		currentWeightG: loadedPlan?.plan.currentWeightG ?? null,
		expectedWeightG: loadedPlan?.plan.expectedWeightG ?? null,
		projectedHarvestG: loadedPlan?.plan.projectedHarvestWeightG ?? null,
		recommendedGrams: loadedPlan?.plan.recommendedGramsPerFeeding ?? null,
		adjustmentAllowed: loadedPlan?.plan.adjustmentAllowed ?? null,
		nextAdjustmentDate: loadedPlan?.plan.nextAdjustmentDate ?? null,
		confidence: loadedPlan?.plan.confidence ?? null,
		samples: biomassDesc.slice(0, 10).map((log) => ({
			date: log.recordedAt.toISOString(),
			avgWeightG: log.avgWeightKg * 1000,
			lengthCm: log.sampleLengthCm,
			batchLabel: log.batchLabel,
		})),
	};

	const sgrLabels: SgrKpiLabels = {
		title: t("sgrTitle"),
		overall: t("sgrOverall"),
		averageGain: t("sgrAverageGain"),
		unit: t("sgrUnit"),
		explanation: t("sgrExplain"),
		reasons: {
			insufficientSamples: t("sgrReasons.insufficientSamples"),
			invalidWeight: t("sgrReasons.invalidWeight"),
			intervalTooShort: t("sgrReasons.intervalTooShort"),
		},
	};

	return (
		<div className="space-y-8 pb-20 animate-in fade-in duration-150 max-w-7xl mx-auto">
			<SnapshotWriter
				page="growth"
				scope={pond.ownerId}
				pondId={pond.id}
				pondName={pond.name}
				data={growthSnapshot}
			/>
			{/* Header with import/export buttons */}
			<DashboardPageHeader
				icon={TrendingUp}
				title={t("title")}
				description={t("desc", { pond: pond.name })}
				actions={
					<>
						<DataImportDialog canWrite={writeAccess} />
						<DataExportButton />
					</>
				}
			/>

			{!writeAccess && (
				<ReadOnlyNotice title={tCommon("readOnlyTitle")} description={tCommon("readOnlyDesc")} />
			)}

			{/* FCR big glance box from Prototype */}
			<div className="bg-[#0A3D62] text-white p-6 md:p-8 rounded-3xl shadow-lg relative overflow-hidden">
				<div
					aria-hidden="true"
					className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full translate-x-12 -translate-y-12"
				/>
				<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-10">
					<div>
						<span className="text-xs uppercase font-extrabold text-blue-200 tracking-wider">
							{t("fcrEyebrow")}
						</span>
						<div className="text-5xl md:text-6xl font-black mt-2 tracking-tight">
							{latestFcr.toFixed(2)}
						</div>
						<p className="text-xs text-blue-100 mt-2 max-w-md">
							{t.rich("fcrExplain", {
								value: latestFcr.toFixed(2),
								bold: (chunks) => <strong>{chunks}</strong>,
							})}
						</p>
					</div>
					<div className="bg-white/10 px-4 py-3 rounded-2xl border border-white/10 shrink-0">
						<p className="text-[10px] text-gray-300 uppercase tracking-widest font-mono">
							{t("stockHealth")}
						</p>
						<p className="text-base font-extrabold text-green-400 flex items-center gap-1.5">
							<TrendingUp className="w-4 h-4" /> {t("stockHealthValue")}
						</p>
					</div>
				</div>
			</div>

			{/* Grow-out cycle context */}
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
						className="inline-flex min-h-11 items-center gap-1 rounded-lg text-xs font-bold text-[#0A3D62] hover:underline focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-[#5b9bd5] dark:focus-visible:outline-[#8fc0ea]"
					>
						{tHarvest("progress")} <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
					</Link>
				</div>
			)}

			{loadedPlan && (
				<GrowthPlanCard plan={loadedPlan.plan} pondId={pond.id} canWrite={writeAccess} />
			)}

			{/* AI Feeding Prediction / fallow state */}
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
						href="/dashboard/harvest"
						className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#164e7c] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:bg-[#1f66a0] dark:focus-visible:outline-[#8fc0ea]"
					>
						{tHarvest("startCycle")} <ChevronRight aria-hidden="true" className="h-4 w-4" />
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

			{/* FCR Calculator */}
			<FcrCalculator latestFcr={latestFcr} />

			<div
				className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
				data-help="growth-charts"
			>
				{/* Latest ABW Card */}
				<div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 flex flex-col justify-between relative overflow-hidden">
					<div className="flex justify-between items-start mb-4 relative z-10">
						<div>
							<p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
								{t("latestAbw")}
							</p>
							<p className="text-4xl font-extrabold text-[var(--ofd-base-deep)] mt-1">
								{(latestBiomass * 1000).toFixed(1)}{" "}
								<span className="text-lg text-gray-500 font-medium">g</span>
							</p>
							{biomassGrowthPct > 0 && (
								<p className="text-sm text-green-700 font-medium mt-1 flex items-center gap-1 dark:text-green-400">
									<TrendingUp aria-hidden="true" className="h-4 w-4" />{" "}
									{t("vsLastSample", { pct: biomassGrowthPct.toFixed(1) })}
								</p>
							)}
						</div>
						<div className="h-14 w-14 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center dark:bg-teal-500/15 dark:text-teal-300">
							<Fish aria-hidden="true" className="h-7 w-7" />
						</div>
					</div>

					{/* Biomass Chart */}
					<div className="h-24 w-full relative mt-4">
						<svg
							viewBox="0 0 400 100"
							preserveAspectRatio="none"
							className="h-full w-full overflow-visible"
							role="img"
							aria-label={t("biomassChartLabel")}
						>
							<title>{t("biomassChartLabel")}</title>
							<defs>
								<linearGradient id="bioGrad" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="var(--ofd-action)" stopOpacity="0.2" />
									<stop offset="100%" stopColor="var(--ofd-action)" stopOpacity="0" />
								</linearGradient>
							</defs>
							<path d={`${generateBiomassPath()} L 400,100 L 0,100 Z`} fill="url(#bioGrad)" />
							<path
								d={generateBiomassPath()}
								fill="none"
								stroke="var(--ofd-action)"
								strokeWidth="4"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="drop-shadow-md"
							/>
							{biomassLogs.map((log, i) => {
								if (biomassLogs.length < 2) return null;
								const x = (i / (biomassLogs.length - 1)) * 400;
								const y = 100 - ((log.avgWeightKg - minBiomass) / (maxBiomass - minBiomass)) * 100;
								return (
									<circle
										key={log.id}
										cx={x}
										cy={y}
										r="5"
										fill="white"
										stroke="var(--ofd-action)"
										strokeWidth="3"
									/>
								);
							})}
						</svg>
						<span className="sr-only">
							{t("chartSummary", {
								count: biomassLogs.length,
								latest: (latestBiomass * 1000).toFixed(1),
								fcr: latestFcr.toFixed(2),
							})}
						</span>
					</div>
				</div>

				{/* Latest FCR Card */}
				<div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 flex flex-col justify-between">
					<div className="flex justify-between items-start mb-4">
						<div>
							<p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
								{t("currentFcr")}
							</p>
							<p className="text-4xl font-extrabold text-[var(--ofd-base-deep)] mt-1">
								{latestFcr.toFixed(2)}
							</p>
							<p className="text-sm text-green-700 font-medium mt-1 flex items-center gap-1 dark:text-green-400">
								{t("trendingDown")} <Activity aria-hidden="true" className="h-4 w-4" />
							</p>
						</div>
						<div className="h-14 w-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center dark:bg-blue-500/15 dark:text-blue-300">
							<Scale aria-hidden="true" className="h-7 w-7" />
						</div>
					</div>

					{/* FCR Bar Chart (Tailwind CSS) */}
					<div className="mt-4 flex items-end justify-between h-24 gap-2" aria-hidden="true">
						{fcrReports.map((report) => {
							const maxFcr = Math.max(...fcrReports.map((r) => r.fcrValue), 2.5);
							const heightPct = (report.fcrValue / maxFcr) * 100;
							return (
								<div
									key={report.id}
									className="flex-1 flex flex-col justify-end items-center group"
								>
									<div className="text-xs font-bold text-gray-600 dark:text-gray-300 mb-1">
										{report.fcrValue.toFixed(2)}
									</div>
									<div
										className="w-full bg-blue-100 rounded-t-lg group-hover:bg-blue-300 transition-colors relative dark:bg-blue-500/15 dark:group-hover:bg-blue-500/25"
										style={{ height: `${heightPct}%` }}
									>
										<div
											className="absolute bottom-0 w-full bg-blue-500 rounded-t-lg transition-all"
											style={{ height: "4px" }}
										/>
									</div>
									<div className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-medium">
										{formatDate(report.periodEnd)}
									</div>
								</div>
							);
						})}
					</div>
					<span className="sr-only">
						{t("chartSummary", {
							count: fcrReports.length,
							latest: (latestBiomass * 1000).toFixed(1),
							fcr: latestFcr.toFixed(2),
						})}
					</span>
				</div>

				{/* Specific Growth Rate (capstone objective) */}
				<SgrKpi
					latestSgrPctPerDay={latestSgrPctPerDay}
					overallSgrPctPerDay={overallSgrPctPerDay}
					averageDailyGainG={sgrAverageDailyGainG}
					reason={sgrReason}
					labels={sgrLabels}
				/>
			</div>

			{/* Feed Level Trend Card */}
			{feedLevelLogs.length > 0 && (
				<div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50">
					<div className="flex items-center justify-between mb-4">
						<div>
							<h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
								{t("feedLevelTitle")}
							</h2>
							<p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
								{t("feedLevelDesc")}
							</p>
						</div>
						<Package aria-hidden="true" className="h-6 w-6 text-orange-600" />
					</div>
					<div className="h-24 w-full relative">
						<svg
							viewBox="0 0 400 100"
							preserveAspectRatio="none"
							className="h-full w-full overflow-visible"
							role="img"
							aria-label={t("feedLevelTitle")}
						>
							<title>{t("feedLevelTitle")}</title>
							<defs>
								<linearGradient id="feedLevelGrad" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="#f97316" stopOpacity="0.2" />
									<stop offset="100%" stopColor="#f97316" stopOpacity="0" />
								</linearGradient>
							</defs>
							<path
								d={`${generateFeedLevelPath()} L 400,100 L 0,100 Z`}
								fill="url(#feedLevelGrad)"
							/>
							<path
								d={generateFeedLevelPath()}
								fill="none"
								stroke="#f97316"
								strokeWidth="4"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="drop-shadow-md"
							/>
							{feedLevelLogs.length >= 2 &&
								feedLevelLogs.map((log, i) => {
									const x = (i / (feedLevelLogs.length - 1)) * 400;
									const y = 100 - ((log.levelPercent - minLevel) / (maxLevel - minLevel)) * 100;
									return (
										<circle
											key={log.id}
											cx={x}
											cy={y}
											r="5"
											fill="white"
											stroke="#f97316"
											strokeWidth="3"
										/>
									);
								})}
						</svg>
						<span className="sr-only">
							{t("feedChartSummary", {
								count: feedLevelLogs.length,
								latest: Math.round(feedLevelLogs[feedLevelLogs.length - 1]?.levelPercent ?? 0),
							})}
						</span>
					</div>
				</div>
			)}

			{/* Feed Level Log preview */}
			<div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
				{energyDevice && feedLevelPreview.length > 0 && (
					<DashboardSection
						icon={Package}
						title={t("feedLevelTableTitle")}
						action={
							<Link href="/dashboard/growth/history?tab=feed" className={dashboardSectionLink}>
								{t("viewAll")}
								<ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
							</Link>
						}
						flush
					>
						<ul
							aria-label={t("feedLevelTableCaption")}
							className="divide-y divide-gray-100 px-4 dark:divide-gray-700/50 sm:px-6"
						>
							{feedLevelPreview.map((log) => (
								<li key={log.id} className="flex items-center justify-between gap-3 py-3.5">
									<div className="whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
										{formatFarmDateTime(log.recordedAt, tDates).fullDate}
									</div>
									<div>
										<span
											className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
												log.levelPercent <= 5
													? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
													: log.levelPercent <= 20
														? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
														: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
											}`}
										>
											{Math.round(log.levelPercent)}%
										</span>
									</div>
									<div className="font-mono text-gray-600 dark:text-gray-300">
										{log.distanceCm.toFixed(1)} cm
									</div>
								</li>
							))}
						</ul>
					</DashboardSection>
				)}

				{/* Growth Summary Table */}
				{growthRows.length >= 2 && (
					<DashboardSection
						title={t("summaryTitle")}
						description={t("summaryDesc")}
						action={
							<Link
								href="/dashboard/growth/history?tab=growth"
								data-help="growth-history"
								className={dashboardSectionLink}
							>
								{t("viewAll")}
								<ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
							</Link>
						}
						flush
					>
						<DashboardTable caption={t("tableCaption")} minWidth="min-w-[36rem]">
							<DashboardTHead>
								<DashboardTh>{t("dateCol")}</DashboardTh>
								<DashboardTh align="right">{t("history.columns.avgWeight")}</DashboardTh>
								<DashboardTh align="right">{t("avgLengthCol")}</DashboardTh>
								<DashboardTh align="right">{t("history.columns.weightGain")}</DashboardTh>
								<DashboardTh align="right">{t("history.columns.lengthGain")}</DashboardTh>
								<DashboardTh align="right">{t("history.columns.daysSince")}</DashboardTh>
							</DashboardTHead>
							<tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
								{growthRows
									.slice(0, GROWTH_PREVIEW_ROWS)
									.map(({ log, weightGain, lengthGain, daysSinceLast }) => (
										<DashboardTr key={log.id}>
											<DashboardTd className="whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
												{formatFarmDateTime(log.recordedAt, tDates).fullDate}
											</DashboardTd>
											<DashboardTd className="text-right">
												{(log.avgWeightKg * 1000).toFixed(1)} g
											</DashboardTd>
											<DashboardTd className="text-right">
												{log.sampleLengthCm.toFixed(1)} cm
											</DashboardTd>
											<DashboardTd className="text-right font-bold">
												{weightGain !== null ? (
													<span
														className={
															weightGain >= 0
																? "text-green-700 dark:text-green-400"
																: "text-red-600 dark:text-red-400"
														}
													>
														{weightGain >= 0 ? "+" : ""}
														{weightGain.toFixed(1)}
													</span>
												) : (
													<span className="text-gray-400">—</span>
												)}
											</DashboardTd>
											<DashboardTd className="text-right font-bold">
												{lengthGain !== null ? (
													<span
														className={
															lengthGain >= 0
																? "text-green-700 dark:text-green-400"
																: "text-red-600 dark:text-red-400"
														}
													>
														{lengthGain >= 0 ? "+" : ""}
														{lengthGain.toFixed(1)}
													</span>
												) : (
													<span className="text-gray-400">—</span>
												)}
											</DashboardTd>
											<DashboardTd className="text-right">
												{daysSinceLast !== null ? (
													<span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
														{daysSinceLast}d
													</span>
												) : (
													<span className="text-gray-400">—</span>
												)}
											</DashboardTd>
										</DashboardTr>
									))}
							</tbody>
						</DashboardTable>

						{/* Narrow screens: the same rows as cards, no horizontal scroll. */}
						<DashboardCardList label={t("tableCaption")} className="p-4">
							{growthRows.slice(0, GROWTH_PREVIEW_ROWS).map(({ log, weightGain, lengthGain }) => (
								<DashboardCard key={log.id}>
									<p className="text-xs font-black text-[#0A3D62] dark:text-[#5b9bd5]">
										{formatFarmDateTime(log.recordedAt, tDates).fullDate}
									</p>
									<div className="mt-2">
										<DashboardCardRow label={t("history.columns.avgWeight")}>
											{(log.avgWeightKg * 1000).toFixed(1)} g
										</DashboardCardRow>
										<DashboardCardRow label={t("avgLengthCol")}>
											{log.sampleLengthCm.toFixed(1)} cm
										</DashboardCardRow>
										<DashboardCardRow label={t("history.columns.weightGain")}>
											{weightGain !== null
												? `${weightGain >= 0 ? "+" : ""}${weightGain.toFixed(1)} g`
												: "—"}
										</DashboardCardRow>
										<DashboardCardRow label={t("history.columns.lengthGain")}>
											{lengthGain !== null
												? `${lengthGain >= 0 ? "+" : ""}${lengthGain.toFixed(1)} cm`
												: "—"}
										</DashboardCardRow>
									</div>
								</DashboardCard>
							))}
						</DashboardCardList>
					</DashboardSection>
				)}

				{/* Biomass Log Table */}
				<DashboardSection
					className="xl:col-span-2"
					title={t("historyTitle")}
					action={
						<Link href="/dashboard/growth/history?tab=biomass" className={dashboardSectionLink}>
							{t("viewAll")}
							<ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
						</Link>
					}
					flush
				>
					{biomassDesc.length === 0 ? (
						<div className="p-4 sm:p-6">
							<DashboardEmptyState
								icon={Scale}
								title={t("noSamplesTitle")}
								description={t("noSamplesDesc")}
								action={
									<Link href="/dashboard/log-sample" className={dashboardSectionLink}>
										{t("logSampleAction")}
									</Link>
								}
							/>
						</div>
					) : (
						<>
							<DashboardTable caption={t("biomassTableCaption")} minWidth="min-w-[40rem]">
								<DashboardTHead>
									<DashboardTh>{t("dateCol")}</DashboardTh>
									<DashboardTh>{t("batchCol")}</DashboardTh>
									<DashboardTh>{t("totalWeightCol")}</DashboardTh>
									<DashboardTh>{t("fishCountCol")}</DashboardTh>
									<DashboardTh>{t("avgLengthCol")}</DashboardTh>
									<DashboardTh align="right">{t("abwCol")}</DashboardTh>
									<DashboardTh align="right">{t("typeCol")}</DashboardTh>
								</DashboardTHead>
								<tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
									{biomassDesc.slice(0, PREVIEW_ROWS).map((log) => (
										<DashboardTr key={log.id}>
											<DashboardTd className="whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
												{formatFarmDateTime(log.recordedAt, tDates).fullDate}
											</DashboardTd>
											<DashboardTd className="whitespace-nowrap">
												{log.batchLabel ?? <span className="text-gray-400">—</span>}
											</DashboardTd>
											<DashboardTd>{log.sampleWeightKg.toFixed(2)} kg</DashboardTd>
											<DashboardTd>{log.sampleCount}</DashboardTd>
											<DashboardTd>{log.sampleLengthCm.toFixed(1)} cm</DashboardTd>
											<DashboardTd className="text-right font-bold text-[var(--ofd-base-deep)]">
												{(log.avgWeightKg * 1000).toFixed(1)} g
											</DashboardTd>
											<DashboardTd className="text-right">
												{log.fishSamples.length > 0 ? (
													<details className="inline-block text-left">
														<summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700 transition-colors hover:bg-teal-100 dark:bg-teal-500/15 dark:text-teal-300 dark:hover:bg-teal-500/25">
															<Fish aria-hidden="true" className="w-3 h-3" />
															{t("fishCountBadge", { count: log.fishSamples.length })}
														</summary>
														<div className="mt-2 min-w-[180px] overflow-hidden rounded-xl border border-teal-100 bg-teal-50/50 dark:border-teal-500/20 dark:bg-teal-500/10">
															<div className="flex items-baseline justify-between gap-3 bg-teal-100/70 px-3 py-1.5 text-[10px] font-bold uppercase text-teal-700 dark:bg-teal-500/20 dark:text-teal-200">
																<span className="truncate">
																	{log.batchLabel ?? t("unlabeledBatch")}
																</span>
																<span className="shrink-0 font-medium normal-case text-teal-600 dark:text-teal-300">
																	{formatFarmDateTime(log.recordedAt, tDates).date}
																</span>
															</div>
															<table className="w-full text-xs text-gray-600 dark:text-gray-300">
																<caption className="sr-only">{t("fishSamplesLabel")}</caption>
																<thead>
																	<tr className="text-[10px] uppercase text-teal-700 dark:text-teal-300">
																		<th scope="col" className="px-3 py-1.5 text-left font-bold">
																			#
																		</th>
																		<th scope="col" className="px-3 py-1.5 text-right font-bold">
																			{t("sampleWeightCol")}
																		</th>
																		<th scope="col" className="px-3 py-1.5 text-right font-bold">
																			{t("sampleLengthCol")}
																		</th>
																	</tr>
																</thead>
																<tbody className="divide-y divide-teal-100 dark:divide-teal-500/20">
																	{log.fishSamples.map((sample, sampleIndex) => (
																		<tr key={sample.id}>
																			<td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">
																				{sampleIndex + 1}
																			</td>
																			<td className="px-3 py-1.5 text-right font-medium text-gray-800 dark:text-gray-100">
																				{sample.weightGrams.toFixed(1)} g
																			</td>
																			<td className="px-3 py-1.5 text-right">
																				{sample.lengthCm > 0
																					? `${sample.lengthCm.toFixed(1)} cm`
																					: "—"}
																			</td>
																		</tr>
																	))}
																</tbody>
															</table>
														</div>
													</details>
												) : (
													<span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600 dark:bg-white/10 dark:text-gray-300">
														<Scale aria-hidden="true" className="w-3 h-3" />
														{t("avgBadge")}
													</span>
												)}
											</DashboardTd>
										</DashboardTr>
									))}
								</tbody>
							</DashboardTable>

							<DashboardCardList label={t("biomassTableCaption")} className="p-4">
								{biomassDesc.slice(0, PREVIEW_ROWS).map((log) => (
									<DashboardCard key={log.id}>
										<div className="flex items-baseline justify-between gap-3">
											<p className="text-xs font-black text-[#0A3D62] dark:text-[#5b9bd5]">
												{formatFarmDateTime(log.recordedAt, tDates).fullDate}
											</p>
											<p className="text-sm font-black text-[var(--ofd-base-deep)]">
												{(log.avgWeightKg * 1000).toFixed(1)} g
											</p>
										</div>
										<div className="mt-2">
											<DashboardCardRow label={t("batchCol")}>
												{log.batchLabel ?? t("unlabeledBatch")}
											</DashboardCardRow>
											<DashboardCardRow label={t("totalWeightCol")}>
												{log.sampleWeightKg.toFixed(2)} kg
											</DashboardCardRow>
											<DashboardCardRow label={t("fishCountCol")}>
												{log.sampleCount}
											</DashboardCardRow>
											<DashboardCardRow label={t("avgLengthCol")}>
												{log.sampleLengthCm.toFixed(1)} cm
											</DashboardCardRow>
										</div>
									</DashboardCard>
								))}
							</DashboardCardList>
						</>
					)}
				</DashboardSection>
			</div>
		</div>
	);
}
