import prisma from "@/lib/prisma";
import { Activity, Fish, Scale, TrendingUp } from "lucide-react";

export const revalidate = 0;

export default async function GrowthPage() {
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
	});

	if (!pond) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500">No pond data found.</p>
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

	const latestFcr = fcrReports.length > 0 ? fcrReports[fcrReports.length - 1].fcrValue : 0;
	const latestBiomass =
		biomassLogs.length > 0 ? biomassLogs[biomassLogs.length - 1].avgWeightKg : 0;
	const previousBiomass =
		biomassLogs.length > 1 ? biomassLogs[biomassLogs.length - 2].avgWeightKg : 0;

	const biomassGrowthPct =
		previousBiomass > 0 ? ((latestBiomass - previousBiomass) / previousBiomass) * 100 : 0;

	const formatDate = (d: Date) =>
		new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);

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

	return (
		<div className="space-y-8 pb-20 animate-in fade-in duration-500">
			<header>
				<h1 className="text-3xl font-extrabold tracking-tight text-[var(--ofd-base-deep)]">
					Growth & FCR
				</h1>
				<p className="text-gray-500 mt-1">
					Biomass tracking and Feed Conversion Ratio for {pond.name}
				</p>
			</header>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				{/* Latest ABW Card */}
				<div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex flex-col justify-between relative overflow-hidden">
					<div className="flex justify-between items-start mb-4 relative z-10">
						<div>
							<p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
								Latest ABW
							</p>
							<p className="text-4xl font-extrabold text-[var(--ofd-base-deep)] mt-1">
								{(latestBiomass * 1000).toFixed(1)}{" "}
								<span className="text-lg text-gray-400 font-medium">g</span>
							</p>
							{biomassGrowthPct > 0 && (
								<p className="text-sm text-green-600 font-medium mt-1 flex items-center gap-1">
									<TrendingUp className="h-4 w-4" /> +{biomassGrowthPct.toFixed(1)}% vs last sample
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
								Current FCR
							</p>
							<p className="text-4xl font-extrabold text-[var(--ofd-base-deep)] mt-1">
								{latestFcr.toFixed(2)}
							</p>
							<p className="text-sm text-green-600 font-medium mt-1 flex items-center gap-1">
								Trending downwards <Activity className="h-4 w-4" />
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

			{/* Biomass Log Table */}
			<div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mt-8">
				<div className="p-6 border-b border-gray-100 bg-gray-50/50">
					<h3 className="font-bold text-gray-800">Biomass Sample History</h3>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm text-gray-600">
						<thead className="bg-gray-50 text-gray-500 uppercase text-xs font-semibold">
							<tr>
								<th className="px-6 py-4">Date</th>
								<th className="px-6 py-4">Total Weight</th>
								<th className="px-6 py-4">Fish Count</th>
								<th className="px-6 py-4">Avg Length</th>
								<th className="px-6 py-4 text-right text-[var(--ofd-base-deep)]">ABW (g)</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-100">
							{biomassLogs
								.slice()
								.reverse()
								.map((log) => (
									<tr key={log.id} className="hover:bg-gray-50 transition-colors">
										<td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
											{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
												log.recordedAt,
											)}
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
										No biomass samples recorded yet.
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
