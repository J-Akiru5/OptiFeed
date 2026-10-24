import { DataExportButton, DataImportDialog } from "@/components/DataImportExport";
import { FcrCalculator } from "@/components/FcrCalculator";
import { FeedingPredictionCard } from "@/components/FeedingPredictionCard";
import { Link } from "@/i18n/routing";
import { canWrite } from "@/lib/auth/session";
import { DEFAULT_FISH_COUNT } from "@/lib/constants";
import { formatDateTimeLocal } from "@/lib/date-local";
import { getActivePond } from "@/lib/pond-selection";
import { computeDeterministicPrediction } from "@/lib/prediction";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { Activity, ChevronRight, Fish, Package, Scale, TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

const PREVIEW_ROWS = 5;
const GROWTH_PREVIEW_ROWS = 6;

export default async function GrowthPage() {
	const t = await getTranslations("dashboard.growth");
	const tSch = await getTranslations("dashboard.schedule");
	const tDates = await getTranslations("dates");
	const pond = await getActivePond();

	if (!pond) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500 dark:text-gray-400">{tSch("noPondData")}</p>
			</div>
		);
	}

	const writeAccess = await canWrite();

	const biomassLogs = await prisma.biomassLog.findMany({
		where: { pondId: pond.id },
		orderBy: { recordedAt: "asc" },
		include: { fishSamples: true },
	});

	// Newest first, with the period-over-period gains precomputed once. The
	// compact card and the growth-history page share the same calculation.
	const biomassDesc = biomassLogs.slice().reverse();
	const growthRows = biomassDesc.map((log, index) => {
		const previous = biomassDesc[index + 1] ?? null;
		const weightGain = previous ? log.avgWeightKg * 1000 - previous.avgWeightKg * 1000 : null;
		const lengthGain = previous ? log.sampleLengthCm - previous.sampleLengthCm : null;
		const daysSinceLast = previous
			? Math.round((log.recordedAt.getTime() - previous.recordedAt.getTime()) / 86_400_000)
			: null;
		return { log, weightGain, lengthGain, daysSinceLast };
	});

	const fcrReports = await prisma.fcrReport.findMany({
		where: { pondId: pond.id },
		orderBy: { periodEnd: "asc" },
	});

	const energyDevice = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
		select: { id: true, gramsPerFeeding: true, hopperCapacityG: true },
	});

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
	});

	let feedLevelLogs: Awaited<ReturnType<typeof prisma.feedLevelLog.findMany>> = [];
	let feedLevelPreview: {
		id: string;
		recordedAt: Date;
		levelPercent: number;
		distanceCm: number;
	}[] = [];
	if (energyDevice) {
		feedLevelLogs = await prisma.feedLevelLog.findMany({
			where: { deviceId: energyDevice.id },
			orderBy: { recordedAt: "asc" },
			take: 30,
		});
		feedLevelPreview = await prisma.feedLevelLog.findMany({
			where: { deviceId: energyDevice.id },
			orderBy: { recordedAt: "desc" },
			take: PREVIEW_ROWS,
			select: { id: true, recordedAt: true, levelPercent: true, distanceCm: true },
		});
	}

	const latestFcr = fcrReports.length > 0 ? fcrReports[fcrReports.length - 1].fcrValue : 0;
	const latestBiomass =
		biomassLogs.length > 0 ? biomassLogs[biomassLogs.length - 1].avgWeightKg : 0;
	const previousBiomass =
		biomassLogs.length > 1 ? biomassLogs[biomassLogs.length - 2].avgWeightKg : 0;

	const biomassGrowthPct =
		previousBiomass > 0 ? ((latestBiomass - previousBiomass) / previousBiomass) * 100 : 0;

	const formatDate = (d: Date) => formatDateTimeLocal(d, tDates).date;

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

	return (
		<div className="space-y-8 pb-20 animate-in fade-in duration-500 max-w-7xl mx-auto">
			{/* Header with import/export buttons */}
			<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
				<div>
					<h1 className="text-3xl font-extrabold tracking-tight text-[var(--ofd-base-deep)]">
						{t("title")}
					</h1>
					<p className="text-gray-500 dark:text-gray-400 mt-1">{t("desc", { pond: pond.name })}</p>
				</div>
				<div className="flex items-center gap-3">
					<DataImportDialog canWrite={writeAccess} />
					<DataExportButton />
				</div>
			</div>

			{/* FCR big glance box from Prototype */}
			<div className="bg-[#0A3D62] text-white p-6 md:p-8 rounded-[32px] shadow-lg relative overflow-hidden">
				<div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full translate-x-12 -translate-y-12" />
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

			{/* AI Feeding Prediction */}
			{energyDevice && (
				<FeedingPredictionCard deviceId={energyDevice.id} initialPrediction={initialPrediction} />
			)}

			{/* FCR Calculator */}
			<FcrCalculator latestFcr={latestFcr} />

			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				{/* Latest ABW Card */}
				<div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 flex flex-col justify-between relative overflow-hidden">
					<div className="flex justify-between items-start mb-4 relative z-10">
						<div>
							<p className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
								{t("latestAbw")}
							</p>
							<p className="text-4xl font-extrabold text-[var(--ofd-base-deep)] mt-1">
								{(latestBiomass * 1000).toFixed(1)}{" "}
								<span className="text-lg text-gray-400 font-medium">g</span>
							</p>
							{biomassGrowthPct > 0 && (
								<p className="text-sm text-green-600 font-medium mt-1 flex items-center gap-1">
									<TrendingUp className="h-4 w-4" />{" "}
									{t("vsLastSample", { pct: biomassGrowthPct.toFixed(1) })}
								</p>
							)}
						</div>
						<div className="h-14 w-14 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center">
							<Fish className="h-7 w-7" />
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
					</div>
				</div>

				{/* Latest FCR Card */}
				<div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 flex flex-col justify-between">
					<div className="flex justify-between items-start mb-4">
						<div>
							<p className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
								{t("currentFcr")}
							</p>
							<p className="text-4xl font-extrabold text-[var(--ofd-base-deep)] mt-1">
								{latestFcr.toFixed(2)}
							</p>
							<p className="text-sm text-green-600 font-medium mt-1 flex items-center gap-1">
								{t("trendingDown")} <Activity className="h-4 w-4" />
							</p>
						</div>
						<div className="h-14 w-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
							<Scale className="h-7 w-7" />
						</div>
					</div>

					{/* FCR Bar Chart (Tailwind CSS) */}
					<div className="mt-4 flex items-end justify-between h-24 gap-2">
						{fcrReports.map((report) => {
							const maxFcr = Math.max(...fcrReports.map((r) => r.fcrValue), 2.5);
							const heightPct = (report.fcrValue / maxFcr) * 100;
							return (
								<div
									key={report.id}
									className="flex-1 flex flex-col justify-end items-center group cursor-pointer"
								>
									<div className="text-xs font-bold text-gray-400 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
										{report.fcrValue.toFixed(2)}
									</div>
									<div
										className="w-full bg-blue-100 rounded-t-lg group-hover:bg-blue-300 transition-colors relative"
										style={{ height: `${heightPct}%` }}
									>
										<div
											className="absolute bottom-0 w-full bg-blue-500 rounded-t-lg transition-all"
											style={{ height: "4px" }}
										/>
									</div>
									<div className="text-xs text-gray-400 mt-2 font-medium">
										{formatDate(report.periodEnd)}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			</div>

			{/* Feed Level Trend Card */}
			{feedLevelLogs.length > 0 && (
				<div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50">
					<div className="flex items-center justify-between mb-4">
						<div>
							<p className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
								{t("feedLevelTitle")}
							</p>
							<p className="text-xs text-gray-400 mt-0.5">{t("feedLevelDesc")}</p>
						</div>
						<Package className="h-6 w-6 text-orange-500" />
					</div>
					<div className="h-24 w-full relative">
						<svg
							viewBox="0 0 400 100"
							preserveAspectRatio="none"
							className="h-full w-full overflow-visible"
							role="img"
							aria-label={t("feedLevelTitle")}
						>
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
					</div>
				</div>
			)}

			{/* Feed Level Log preview */}
			<div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
				{energyDevice && feedLevelPreview.length > 0 && (
					<div className="bg-white dark:bg-gray-900 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700/50 overflow-hidden">
						<div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/50 p-6 dark:border-gray-700/50 dark:bg-gray-800/50">
							<h3 className="font-bold text-gray-800 dark:text-gray-100">
								{t("feedLevelTableTitle")}
							</h3>
							<Link
								href="/dashboard/growth/history?tab=feed"
								className="text-sm font-bold text-[var(--ofd-base-deep)] hover:underline"
							>
								{t("viewAll")}
							</Link>
						</div>
						<div className="divide-y divide-gray-100 px-6 dark:divide-gray-700/50">
							{feedLevelPreview.map((log) => (
								<div key={log.id} className="flex items-center justify-between py-3.5">
									<div className="whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
										{formatDateTimeLocal(log.recordedAt, tDates).fullDate}
									</div>
									<div>
										<span
											className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
												log.levelPercent <= 5
													? "bg-red-100 text-red-700"
													: log.levelPercent <= 20
														? "bg-amber-100 text-amber-700"
														: "bg-green-100 text-green-700"
											}`}
										>
											{Math.round(log.levelPercent)}%
										</span>
									</div>
									<div className="font-mono text-gray-600 dark:text-gray-300">
										{log.distanceCm.toFixed(1)} cm
									</div>
								</div>
							))}
						</div>
					</div>
				)}

				{/* Growth Summary Table */}
				{growthRows.length >= 2 && (
					<div className="@container bg-white dark:bg-gray-900 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700/50 overflow-hidden">
						<div className="flex items-start justify-between gap-3 border-b border-gray-100 bg-gray-50/50 p-6 dark:border-gray-700/50 dark:bg-gray-800/50">
							<div>
								<h3 className="font-bold text-gray-800 dark:text-gray-100">{t("summaryTitle")}</h3>
								<p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("summaryDesc")}</p>
							</div>
							<Link
								href="/dashboard/growth/history?tab=growth"
								className="text-sm font-bold text-[var(--ofd-base-deep)] hover:underline"
							>
								{t("viewAll")}
							</Link>
						</div>
						<div className="overflow-x-auto">
							<table className="w-full text-left text-sm text-gray-600 dark:text-gray-300">
								<thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 uppercase text-xs font-semibold">
									<tr>
										<th className="px-3 py-3 lg:px-4">{t("dateCol")}</th>
										<th className="px-3 py-3 text-right lg:px-4">
											{t("history.columns.avgWeight")}
										</th>
										<th className="px-3 py-3 text-right lg:px-4">{t("avgLengthCol")}</th>
										<th className="px-3 py-3 text-right lg:px-4">
											{t("history.columns.weightGain")}
										</th>
										<th className="px-3 py-3 text-right lg:px-4">
											{t("history.columns.lengthGain")}
										</th>
										<th className="px-3 py-3 text-right hidden @[560px]:table-cell lg:px-4">
											{t("history.columns.daysSince")}
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
									{growthRows
										.slice(0, GROWTH_PREVIEW_ROWS)
										.map(({ log, weightGain, lengthGain, daysSinceLast }) => (
											<tr
												key={log.id}
												className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
											>
												<td className="px-3 py-3 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap lg:px-4">
													{formatDateTimeLocal(log.recordedAt, tDates).fullDate}
												</td>
												<td className="px-3 py-3 text-right lg:px-4">
													{(log.avgWeightKg * 1000).toFixed(1)}
												</td>
												<td className="px-3 py-3 text-right lg:px-4">
													{log.sampleLengthCm.toFixed(1)}
												</td>
												<td className="px-3 py-3 text-right font-bold lg:px-4">
													{weightGain !== null ? (
														<span className={weightGain >= 0 ? "text-green-600" : "text-red-500"}>
															{weightGain >= 0 ? "+" : ""}
															{weightGain.toFixed(1)}
														</span>
													) : (
														<span className="text-gray-400">—</span>
													)}
												</td>
												<td className="px-3 py-3 text-right font-bold lg:px-4">
													{lengthGain !== null ? (
														<span className={lengthGain >= 0 ? "text-green-600" : "text-red-500"}>
															{lengthGain >= 0 ? "+" : ""}
															{lengthGain.toFixed(1)}
														</span>
													) : (
														<span className="text-gray-400">—</span>
													)}
												</td>
												<td className="px-3 py-3 text-right hidden @[560px]:table-cell lg:px-4">
													{daysSinceLast !== null ? (
														<span className="inline-flex items-center px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-full">
															{daysSinceLast}d
														</span>
													) : (
														<span className="text-gray-400">—</span>
													)}
												</td>
											</tr>
										))}
								</tbody>
							</table>
						</div>
					</div>
				)}

				{/* Biomass Log Table */}
				<div className="bg-white dark:bg-gray-900 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700/50 overflow-hidden mt-8 xl:mt-0 xl:col-span-2">
					<div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/50 p-6 dark:border-gray-700/50 dark:bg-gray-800/50">
						<h3 className="font-bold text-gray-800 dark:text-gray-100">{t("historyTitle")}</h3>
						<Link
							href="/dashboard/growth/history?tab=biomass"
							className="text-sm font-bold text-[var(--ofd-base-deep)] hover:underline"
						>
							{t("viewAll")}
						</Link>
					</div>
					{/* No overflow-x-auto: secondary columns collapse below lg so the
					    card fits a phone without a horizontal scrollbar (GH-94). */}
					<div>
						<table className="w-full text-left text-sm text-gray-600 dark:text-gray-300">
							<thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 uppercase text-xs font-semibold">
								<tr>
									<th className="px-3 py-3 lg:px-4">{t("dateCol")}</th>
									<th className="px-3 py-3 hidden lg:table-cell lg:px-4">{t("batchCol")}</th>
									<th className="px-3 py-3 lg:px-4">{t("totalWeightCol")}</th>
									<th className="px-3 py-3 hidden lg:table-cell lg:px-4">{t("fishCountCol")}</th>
									<th className="px-3 py-3 hidden lg:table-cell lg:px-4">{t("avgLengthCol")}</th>
									<th className="px-3 py-3 text-right text-[var(--ofd-base-deep)] lg:px-4">
										{t("abwCol")}
									</th>
									<th className="px-3 py-3 text-center hidden lg:table-cell lg:px-4">
										{t("typeCol")}
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
								{biomassDesc.slice(0, PREVIEW_ROWS).map((log) => (
									<tr
										key={log.id}
										className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
									>
										<td className="px-3 py-3 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap lg:px-4">
											{formatDateTimeLocal(log.recordedAt, tDates).fullDate}
										</td>
										<td className="px-3 py-3 whitespace-nowrap hidden lg:table-cell lg:px-4">
											{log.batchLabel ?? <span className="text-gray-400">—</span>}
										</td>
										<td className="px-3 py-3 lg:px-4">{log.sampleWeightKg.toFixed(2)}</td>
										<td className="hidden px-3 py-3 lg:table-cell lg:px-4">{log.sampleCount}</td>
										<td className="hidden px-3 py-3 lg:table-cell lg:px-4">
											{log.sampleLengthCm.toFixed(1)}
										</td>
										<td className="px-3 py-3 text-right font-bold text-[var(--ofd-base-deep)] lg:px-4">
											{(log.avgWeightKg * 1000).toFixed(1)}
										</td>
										<td className="px-3 py-3 text-center hidden lg:table-cell lg:px-4">
											{log.fishSamples.length > 0 ? (
												<details className="inline-block text-left">
													<summary className="inline-flex cursor-pointer list-none items-center gap-1 px-2 py-1 bg-teal-50 text-teal-700 text-xs font-bold rounded-full hover:bg-teal-100 transition-colors">
														<Fish className="w-3 h-3" />
														{t("fishCountBadge", { count: log.fishSamples.length })}
													</summary>
													<div className="mt-2 min-w-[180px] rounded-xl border border-teal-100 bg-teal-50/50 overflow-hidden">
														<div className="flex items-baseline justify-between gap-3 px-3 py-1.5 bg-teal-100/70 text-[10px] font-bold uppercase text-teal-700">
															<span className="truncate">
																{log.batchLabel ?? t("unlabeledBatch")}
															</span>
															<span className="font-medium normal-case text-teal-600 shrink-0">
																{formatDateTimeLocal(log.recordedAt, tDates).date}
															</span>
														</div>
														<table className="w-full text-xs text-gray-600 dark:text-gray-300">
															<thead>
																<tr className="text-[10px] uppercase text-teal-700">
																	<th className="px-3 py-1.5 text-left font-bold">#</th>
																	<th className="px-3 py-1.5 text-right font-bold">
																		{t("sampleWeightCol")}
																	</th>
																	<th className="px-3 py-1.5 text-right font-bold">
																		{t("sampleLengthCol")}
																	</th>
																</tr>
															</thead>
															<tbody className="divide-y divide-teal-100">
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
												<span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-500 dark:text-gray-400 text-xs font-bold rounded-full">
													<Scale className="w-3 h-3" />
													{t("avgBadge")}
												</span>
											)}
										</td>
									</tr>
								))}
								{biomassLogs.length === 0 && (
									<tr>
										<td
											colSpan={5}
											className="px-6 py-10 text-center text-gray-500 dark:text-gray-400"
										>
											{t("noSamples")}
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</div>
	);
}
