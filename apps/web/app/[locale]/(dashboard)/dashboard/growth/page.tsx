import { formatDateTimeLocal } from "@/lib/date-local";
import prisma from "@/lib/prisma";
import { Activity, Fish, Package, Scale, TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

export default async function GrowthPage() {
	const t = await getTranslations("dashboard.growth");
	const tSch = await getTranslations("dashboard.schedule");
	const tDates = await getTranslations("dates");
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
	});

	if (!pond) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500">{tSch("noPondData")}</p>
			</div>
		);
	}

	const biomassLogs = await prisma.biomassLog.findMany({
		where: { pondId: pond.id },
		orderBy: { recordedAt: "asc" },
	});

	const fcrReports = await prisma.fcrReport.findMany({
		where: { pondId: pond.id },
		orderBy: { periodEnd: "asc" },
	});

	const energyDevice = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
		select: { id: true },
	});

	let feedLevelLogs: Awaited<ReturnType<typeof prisma.feedLevelLog.findMany>> = [];
	if (energyDevice) {
		feedLevelLogs = await prisma.feedLevelLog.findMany({
			where: { deviceId: energyDevice.id },
			orderBy: { recordedAt: "asc" },
			take: 30,
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
		<div className="space-y-8 pb-20 animate-in fade-in duration-500 max-w-5xl">
			{/* FCR big glance box from Prototype */}
			<div className="bg-[#0A3D62] text-white p-6 md:p-8 rounded-[32px] shadow-lg relative overflow-hidden">
				<div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full translate-x-12 -translate-y-12" />
				<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-10">
					<div>
						<span className="text-xs uppercase font-extrabold text-blue-200 tracking-wider">
							Current Feed Conversion Ratio
						</span>
						<div className="text-5xl md:text-6xl font-black mt-2 tracking-tight">
							{latestFcr.toFixed(2)}
						</div>
						<p className="text-xs text-blue-100 mt-2 max-w-md">
							An FCR of <strong>{latestFcr.toFixed(2)}</strong> means your African Catfish consume{" "}
							{latestFcr.toFixed(2)}kg of feed pellets for every 1.0kg of raw muscle gain. This
							represents premium commercial growth efficiency.
						</p>
					</div>
					<div className="bg-white/10 px-4 py-3 rounded-2xl border border-white/10 shrink-0">
						<p className="text-[10px] text-gray-300 uppercase tracking-widest font-mono">
							Stock Health Rating
						</p>
						<p className="text-base font-extrabold text-green-400 flex items-center gap-1.5">
							<TrendingUp className="w-4 h-4" /> EXCELLENT • OPTIMAL
						</p>
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				{/* Latest ABW Card */}
				<div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex flex-col justify-between relative overflow-hidden">
					<div className="flex justify-between items-start mb-4 relative z-10">
						<div>
							<p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
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
							aria-label="Biomass Growth Trend"
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
				<div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex flex-col justify-between">
					<div className="flex justify-between items-start mb-4">
						<div>
							<p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
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
				<div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
					<div className="flex items-center justify-between mb-4">
						<div>
							<p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
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
							aria-label="Feed Level Trend"
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

			{/* Feed Level Log Table */}
			{feedLevelLogs.length > 0 && (
				<div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
					<div className="p-6 border-b border-gray-100 bg-gray-50/50">
						<h3 className="font-bold text-gray-800">{t("feedLevelTableTitle")}</h3>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full text-left text-sm text-gray-600">
							<thead className="bg-gray-50 text-gray-500 uppercase text-xs font-semibold">
								<tr>
									<th className="px-6 py-4">{t("dateCol")}</th>
									<th className="px-6 py-4">{t("feedLevelCol")}</th>
									<th className="px-6 py-4">{t("distanceCol")}</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100">
								{[...feedLevelLogs].reverse().map((log) => (
									<tr key={log.id} className="hover:bg-gray-50 transition-colors">
										<td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
											{formatDateTimeLocal(log.recordedAt, tDates).fullDate}
										</td>
										<td className="px-6 py-4">
											<span
												className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
													log.levelPercent <= 5
														? "bg-red-100 text-red-700"
														: log.levelPercent <= 20
															? "bg-amber-100 text-amber-700"
															: "bg-green-100 text-green-700"
												}`}
											>
												{Math.round(log.levelPercent)}%
											</span>
										</td>
										<td className="px-6 py-4 font-mono">{log.distanceCm.toFixed(1)} cm</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Biomass Log Table */}
			<div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mt-8">
				<div className="p-6 border-b border-gray-100 bg-gray-50/50">
					<h3 className="font-bold text-gray-800">{t("historyTitle")}</h3>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm text-gray-600">
						<thead className="bg-gray-50 text-gray-500 uppercase text-xs font-semibold">
							<tr>
								<th className="px-6 py-4">{t("dateCol")}</th>
								<th className="px-6 py-4">{t("totalWeightCol")}</th>
								<th className="px-6 py-4">{t("fishCountCol")}</th>
								<th className="px-6 py-4">{t("avgLengthCol")}</th>
								<th className="px-6 py-4 text-right text-[var(--ofd-base-deep)]">{t("abwCol")}</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-100">
							{biomassLogs
								.slice()
								.reverse()
								.map((log) => (
									<tr key={log.id} className="hover:bg-gray-50 transition-colors">
										<td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
											{formatDateTimeLocal(log.recordedAt, tDates).fullDate}
										</td>
										<td className="px-6 py-4">{log.sampleWeightKg.toFixed(2)} kg</td>
										<td className="px-6 py-4">{log.sampleCount}</td>
										<td className="px-6 py-4">{log.sampleLengthCm.toFixed(1)} cm</td>
										<td className="px-6 py-4 text-right font-bold text-[var(--ofd-base-deep)]">
											{(log.avgWeightKg * 1000).toFixed(1)}g
										</td>
									</tr>
								))}
							{biomassLogs.length === 0 && (
								<tr>
									<td colSpan={5} className="px-6 py-10 text-center text-gray-500">
										{t("noSamples")}
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}
