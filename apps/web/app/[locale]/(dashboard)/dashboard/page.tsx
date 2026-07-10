import { FeedNowButton } from "@/components/FeedNowButton";
import { Link } from "@/i18n/routing";
import prisma from "@/lib/prisma";
import {
	Activity,
	Calendar,
	ChevronRight,
	Layers,
	Sliders,
	Sparkles,
	TrendingUp,
} from "lucide-react";

export const revalidate = 0; // Ensure data is always fresh

export default async function DashboardHomePage() {
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
		include: { devices: true },
	});

	if (!pond || !pond.devices.length) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500">No pond data found. Please run the seed script.</p>
			</div>
		);
	}

	const device = pond.devices[0];

	// Fetch data
	const latestBiomass = await prisma.biomassLog.findFirst({
		where: { pondId: pond.id },
		orderBy: { recordedAt: "desc" },
	});

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const feedingHistory = await prisma.feedingEvent.findMany({
		where: { deviceId: device.id },
		orderBy: { scheduledTime: "desc" },
		take: 5,
	});

	const fcrReports = await prisma.fcrReport.findMany({
		where: { pondId: pond.id },
		orderBy: { periodEnd: "asc" },
		take: 5,
	});
	const latestFcr = fcrReports.length > 0 ? fcrReports[fcrReports.length - 1].fcrValue : 0.0;

	// Calculate next feeding time
	const now = new Date();
	const startHour = pond.scheduleStart.getUTCHours();
	const endHour = pond.scheduleEnd.getUTCHours();
	const feedInterval = (endHour - startHour) / Math.max(1, pond.feedsPerDay - 1);

	let nextFeedTimeObj = null;
	for (let i = 0; i < pond.feedsPerDay; i++) {
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

	const formatTime = (d: Date) =>
		new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(
			d,
		);

	const formatDate = (d: Date) =>
		new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);

	const nextFeedingTimeStr = formatTime(nextFeedTimeObj);
	const nextFeedingVolumeG = 330; // Hardcoded representation for now

	// Calculate days until next physical weighing (assuming every 14 days)
	const daysSinceSample = latestBiomass
		? Math.floor((now.getTime() - latestBiomass.recordedAt.getTime()) / (1000 * 60 * 60 * 24))
		: 0;
	const daysUntilSample = Math.max(0, 14 - daysSinceSample);

	return (
		<div className="space-y-6 pb-20 animate-in fade-in duration-500">
			{/* Welcome row */}
			<div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
				<div>
					<h1 className="text-2xl md:text-3xl font-black text-[#0A3D62] tracking-tight flex items-center gap-2">
						Welcome back, Jeff! <Sparkles className="w-6 h-6 text-[#E85A2A]" />
					</h1>
					<p className="text-[#3D5568] text-xs md:text-sm mt-0.5">
						Monitoring <strong>{pond.name}</strong> remotely from <strong>Western Visayas</strong>{" "}
						node.
					</p>
				</div>

				<FeedNowButton
					deviceId={device.id}
					nextFeedingVolume={`${nextFeedingVolumeG}g`}
					label="Feed Now"
					deviceName={device.name}
					connectionStatus={device.connectivity}
				/>
			</div>

			{/* Bento Grid */}
			<div className="grid grid-cols-1 md:grid-cols-12 gap-6">
				{/* Tile 1: Hero — next feeding time (8 cols) */}
				<div className="col-span-1 md:col-span-8 bg-white rounded-[32px] p-6 md:p-8 shadow-md border border-[#0A3D62]/5 flex flex-col justify-between min-h-[300px] relative overflow-hidden">
					<div className="absolute top-0 right-0 w-32 h-32 bg-[#0A3D62]/5 rounded-full translate-x-12 -translate-y-12" />

					<div>
						<div className="flex items-center gap-2.5">
							<span className="text-[#3D5568] text-xs font-bold uppercase tracking-[0.2em]">
								NEXT SCHEDULED FEEDING
							</span>
							<span
								className={`w-2.5 h-2.5 rounded-full ${
									device.isPaused ? "bg-[#C42B3A]" : "bg-[#1E7B34] animate-pulse"
								}`}
							/>
						</div>

						<div className="text-6xl md:text-8xl font-black text-[#0A3D62] tracking-tighter my-4">
							{device.isPaused ? "—:—" : nextFeedingTimeStr}
						</div>

						<div className="flex flex-wrap items-center gap-3">
							<span
								className={`px-4 py-1.5 rounded-full font-bold text-xs border ${
									device.isPaused
										? "bg-red-50 border-red-200 text-[#C42B3A]"
										: "bg-[#1E7B34]/10 border-[#1E7B34]/20 text-[#1E7B34]"
								}`}
							>
								{device.isPaused ? "Schedule Paused" : "ESP32 Auto-Timer On"}
							</span>
							<span className="text-[#3D5568] text-xs font-medium">
								Based on latest weight sample logged on{" "}
								{latestBiomass ? formatDate(latestBiomass.recordedAt) : "N/A"}
							</span>
						</div>
					</div>

					<div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 pt-6 border-t border-gray-100 mt-6">
						<div className="flex gap-8">
							<div>
								<p className="text-[#3D5568] text-[10px] font-bold uppercase tracking-wider">
									FEED VOLUME
								</p>
								<p className="text-2xl md:text-3xl font-black text-[#E85A2A]">
									{nextFeedingVolumeG}g
								</p>
							</div>
							<div>
								<p className="text-[#3D5568] text-[10px] font-bold uppercase tracking-wider">
									Feeding Rate
								</p>
								<p className="text-2xl md:text-3xl font-black">{pond.feedingRatePct}% BW/Day</p>
							</div>
						</div>

						<Link
							href="/dashboard/log-sample"
							className="bg-[#0A3D62] hover:bg-[#12588c] text-white px-5 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 self-stretch sm:self-auto justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
						>
							Update Biomass Weight <ChevronRight className="w-4 h-4" />
						</Link>
					</div>
				</div>

				{/* Tile 2: FCR (4 cols) */}
				<Link
					href="/dashboard/growth"
					className="col-span-1 md:col-span-4 bg-[#0A3D62] rounded-[32px] p-6 md:p-8 text-white flex flex-col justify-between min-h-[300px] relative overflow-hidden shadow-md hover:bg-[#0d4a76] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
				>
					<div className="absolute bottom-0 right-0 w-32 h-32 bg-white/5 rounded-full translate-x-8 translate-y-8" />
					<div className="flex justify-between items-start">
						<div>
							<p className="text-xs font-extrabold uppercase tracking-widest text-white/60">
								CURRENT FCR
							</p>
							<span className="text-[10px] font-mono bg-white/10 px-2 py-0.5 rounded-full mt-1 inline-block">
								African Catfish Rate
							</span>
						</div>
						<div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
							<TrendingUp className="w-6 h-6 text-green-400" />
						</div>
					</div>

					<div className="my-4">
						<h2 className="text-5xl md:text-6xl font-black text-white tracking-tight">
							{latestFcr.toFixed(2)}
						</h2>
						<p className="text-xs text-white/70 mt-1.5 font-medium">Optimal downward trend</p>
					</div>

					{/* Mini sparkline SVG */}
					<div className="h-16 w-full mt-4 bg-white/5 p-2 rounded-xl border border-white/10">
						<svg
							role="img"
							aria-label="FCR Trend Sparkline"
							className="w-full h-full"
							viewBox="0 0 100 40"
							preserveAspectRatio="none"
						>
							<title>FCR Trend Sparkline</title>
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
				<div className="col-span-1 md:col-span-4 bg-white rounded-3xl p-6 shadow-sm border border-[#0A3D62]/5 flex items-center gap-5">
					<div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center shrink-0">
						<Calendar className="w-7 h-7 text-amber-600" />
					</div>
					<div>
						<p className="text-[10px] font-extrabold uppercase text-[#3D5568] tracking-wider">
							Physical Weighing Due
						</p>
						<p className="text-lg md:text-xl font-black text-[#0A3D62]">{daysUntilSample} Days</p>
						<Link
							href="/dashboard/log-sample"
							className="text-xs text-[#E85A2A] font-extrabold hover:underline flex items-center gap-0.5 mt-0.5 focus-visible:outline-none"
						>
							Schedule Sampling <ChevronRight className="w-3 h-3" />
						</Link>
					</div>
				</div>

				{/* Tile 4: Last biomass weight (4 cols) */}
				<div className="col-span-1 md:col-span-4 bg-white rounded-3xl p-6 shadow-sm border border-[#0A3D62]/5 flex items-center gap-5">
					<div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center shrink-0">
						<Sliders className="w-7 h-7 text-[#0A3D62]" />
					</div>
					<div className="flex-1">
						<p className="text-[10px] font-extrabold uppercase text-[#3D5568] tracking-wider">
							Last Biomass ABW
						</p>
						<p className="text-lg md:text-xl font-black text-[#0A3D62]">
							{latestBiomass ? `${latestBiomass.avgWeightKg * 1000}g` : "N/A"}
						</p>
						<p className="text-[10px] text-[#3D5568]">
							Based on {latestBiomass?.sampleCount ?? 0} sample fish measured.
						</p>
					</div>
				</div>

				{/* Tile 5: Pond population (4 cols) */}
				<div className="col-span-1 md:col-span-4 bg-white rounded-3xl p-6 shadow-sm border border-[#0A3D62]/5 flex items-center gap-5">
					<div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center shrink-0">
						<Layers className="w-7 h-7 text-green-700" />
					</div>
					<div>
						<p className="text-[10px] font-extrabold uppercase text-[#3D5568] tracking-wider">
							Pond Population
						</p>
						<p className="text-lg md:text-xl font-black text-[#0A3D62]">200 Catfish</p>
						<span className="text-[10px] text-[#3D5568] font-mono">Stable stocked quantity</span>
					</div>
				</div>

				{/* Tile 6: Recent feeding logs (12 cols) */}
				<div className="col-span-1 md:col-span-12 bg-white rounded-[32px] p-6 md:p-8 shadow-md border border-[#0A3D62]/5">
					<div className="flex justify-between items-center mb-6">
						<div>
							<h3 className="text-lg md:text-xl font-black uppercase tracking-tight text-[#0A3D62]">
								Feeding Logs —{" "}
								<span className="text-[#3D5568] font-bold opacity-65">Western Visayas Hub</span>
							</h3>
							<p className="text-xs text-[#3D5568]">
								Auditable chronological logs fetched from your automatic dispenser.
							</p>
						</div>
						<Link
							href="/dashboard/history"
							className="text-[#0A3D62] font-extrabold text-sm hover:underline focus-visible:outline-none"
						>
							View complete history
						</Link>
					</div>

					<div className="space-y-3">
						{feedingHistory.map((item, idx) => (
							<div
								key={item.id}
								className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-[#F4F7F6] rounded-2xl border border-[#0A3D62]/5 gap-4"
							>
								<div className="flex items-center gap-4">
									<div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-extrabold text-xs text-[#0A3D62] border border-gray-200 shrink-0">
										0{idx + 1}
									</div>
									<div>
										<div className="flex items-center gap-2">
											<p className="font-extrabold text-base text-[#0A3D62]">
												{formatTime(item.scheduledTime)}
											</p>
											<span className="text-[10px] text-[#3D5568] bg-white border border-gray-200 px-1.5 py-0.5 rounded-full font-mono">
												{formatDate(item.scheduledTime)}
											</span>
										</div>
										<p className="text-xs text-[#3D5568]">
											{item.status === "completed" ? "Scheduled Automatic Dispense" : "Missed"}
										</p>
									</div>
								</div>
								<div className="flex items-center justify-between sm:justify-end gap-6 border-t sm:border-t-0 pt-2 sm:pt-0 border-gray-200">
									<div className="text-left sm:text-right">
										<p className="font-extrabold text-base text-[#0A3D62]">
											{item.dispensedVolumeG}g
										</p>
										<p className="text-[10px] font-bold uppercase text-[#3D5568] opacity-50">
											Amount
										</p>
									</div>
									<span
										className={`px-4 py-1.5 rounded-full font-bold text-xs text-center min-w-[80px] shadow-sm ${
											item.status === "completed"
												? "bg-[#1E7B34] text-white"
												: "bg-[#C42B3A] text-white"
										}`}
									>
										{item.status.toUpperCase()}
									</span>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
