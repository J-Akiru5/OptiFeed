import { EnergyControllerCard } from "@/components/EnergyControllerCard";
import prisma from "@/lib/prisma";
import { Activity, Clock, Droplets, Fish, Wifi, WifiOff } from "lucide-react";

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

	// Fetch ESP32 energy controller (optional — card only renders if present)
	const energyDevice = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
	});

	// Fetch data
	const latestBiomass = await prisma.biomassLog.findFirst({
		where: { pondId: pond.id },
		orderBy: { recordedAt: "desc" },
	});

	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const todaysFeeds = await prisma.feedingEvent.findMany({
		where: {
			deviceId: device.id,
			scheduledTime: { gte: today },
			status: "completed",
		},
	});
	const dailyFeedDispensed = todaysFeeds.reduce((sum, feed) => sum + feed.dispensedVolumeG, 0);

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

	let nextFeedTime = null;
	for (let i = 0; i < pond.feedsPerDay; i++) {
		const feedTime = new Date();
		feedTime.setHours(startHour + i * feedInterval, 0, 0, 0);
		if (feedTime > now) {
			nextFeedTime = feedTime;
			break;
		}
	}
	if (!nextFeedTime) {
		nextFeedTime = new Date();
		nextFeedTime.setDate(nextFeedTime.getDate() + 1);
		nextFeedTime.setHours(startHour, 0, 0, 0);
	}

	const formatTime = (d: Date) =>
		new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d);

	// Simple SVG sparkline points
	const sparklineData = fcrReports.map((r) => r.fcrValue);
	const maxFcr = Math.max(...sparklineData, 2.0);
	const minFcr = Math.min(...sparklineData, 1.0);

	const generateSparklinePath = () => {
		if (sparklineData.length < 2) return "";
		const w = 200;
		const h = 40;
		const points = sparklineData.map((val, i) => {
			const x = (i / (sparklineData.length - 1)) * w;
			const y = h - ((val - minFcr) / (maxFcr - minFcr)) * h;
			return `${x},${y}`;
		});
		return `M ${points.join(" L ")}`;
	};

	return (
		<div className="space-y-6 pb-20 animate-in fade-in duration-500">
			<header>
				<h1 className="text-3xl font-extrabold tracking-tight text-[var(--ofd-base-deep)]">
					Dashboard
				</h1>
				<p className="text-gray-500 mt-1">Overview for {pond.name}</p>
			</header>

			{/* Hero Section */}
			<section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--ofd-base)] to-[var(--ofd-base-deep)] p-8 text-white shadow-xl">
				<div className="absolute -right-10 -top-10 h-64 w-64 rounded-full bg-white/10 blur-3xl mix-blend-overlay" />
				<div className="absolute -bottom-10 -left-10 h-64 w-64 rounded-full bg-[var(--ofd-action)]/20 blur-3xl mix-blend-overlay" />

				<div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
					<div className="space-y-2">
						<p className="text-white/80 font-medium tracking-wide uppercase text-sm">
							Next Scheduled Feeding
						</p>
						<div className="flex items-baseline gap-3">
							<Clock className="h-8 w-8 text-[var(--ofd-action)]" />
							<h2 className="text-5xl font-black tracking-tight">{formatTime(nextFeedTime)}</h2>
						</div>
						<p className="text-white/90 text-lg mt-2">
							<span className="font-semibold text-white">{pond.feedingRatePct}%</span> daily rate
							across <span className="font-semibold text-white">{pond.feedsPerDay}</span> feeds
						</p>
					</div>

					<div className="flex items-center gap-4 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-5 shadow-inner transition-transform hover:scale-105">
						<div
							className={`p-3 rounded-full ${device.connectivity === "online" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}
						>
							{device.connectivity === "online" ? (
								<Wifi className="h-6 w-6" />
							) : (
								<WifiOff className="h-6 w-6" />
							)}
						</div>
						<div>
							<p className="text-xs text-white/70 uppercase tracking-wider font-semibold">
								Device Status
							</p>
							<p className="text-lg font-bold">{device.name}</p>
							<p className="text-sm flex items-center gap-1 mt-0.5">
								<span
									className={`h-2 w-2 rounded-full ${device.connectivity === "online" ? "bg-green-400" : "bg-red-400"}`}
								/>
								{device.connectivity === "online" ? "Online & Ready" : "Offline"}
							</p>
						</div>
					</div>
				</div>
			</section>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
				{/* FCR Sparkline Card */}
				<div className="col-span-1 md:col-span-2 rounded-3xl bg-white p-6 shadow-sm border border-gray-100 transition-shadow hover:shadow-md">
					<div className="flex justify-between items-start mb-6">
						<div>
							<p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
								Current FCR
							</p>
							<h3 className="text-4xl font-extrabold text-[var(--ofd-base-deep)] mt-1">
								{latestFcr.toFixed(2)}
							</h3>
							<p className="text-sm text-green-600 font-medium mt-1 flex items-center gap-1">
								Trending downwards <Activity className="h-4 w-4" />
							</p>
						</div>
						<div className="h-12 w-12 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center">
							<Activity className="h-6 w-6" />
						</div>
					</div>

					<div className="h-24 w-full relative">
						<svg
							viewBox="0 0 200 40"
							preserveAspectRatio="none"
							className="h-full w-full overflow-visible"
							role="img"
							aria-label="FCR Trend Sparkline"
						>
							<defs>
								<linearGradient id="fcrGrad" x1="0" y1="0" x2="1" y2="0">
									<stop offset="0%" stopColor="#94a3b8" />
									<stop offset="100%" stopColor="var(--ofd-action)" />
								</linearGradient>
							</defs>
							<path
								d={generateSparklinePath()}
								fill="none"
								stroke="url(#fcrGrad)"
								strokeWidth="3"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="drop-shadow-md"
							/>
						</svg>
					</div>
				</div>

				{/* Hopper Level Card */}
				<div className="rounded-3xl bg-white p-6 shadow-sm border border-gray-100 transition-shadow hover:shadow-md flex flex-col justify-between group">
					<div className="flex justify-between items-start">
						<div>
							<p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
								Hopper Level
							</p>
							<h3 className="text-4xl font-extrabold text-[var(--ofd-base-deep)] mt-1">
								{device.hopperLevelPct}%
							</h3>
						</div>
						<div className="h-12 w-12 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center group-hover:scale-110 transition-transform">
							<Droplets className="h-6 w-6" />
						</div>
					</div>
					<div className="w-full bg-gray-100 rounded-full h-3 mt-6 overflow-hidden">
						<div
							className="bg-[var(--ofd-action)] h-3 rounded-full transition-all duration-1000 ease-out"
							style={{ width: `${device.hopperLevelPct}%` }}
						/>
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				{/* Latest Biomass Card */}
				<div className="rounded-3xl bg-white p-6 shadow-sm border border-gray-100 flex items-center gap-5 transition-transform hover:-translate-y-1">
					<div className="h-16 w-16 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center flex-shrink-0">
						<Fish className="h-8 w-8" />
					</div>
					<div>
						<p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
							Latest Sample
						</p>
						<p className="text-3xl font-extrabold text-[var(--ofd-base-deep)]">
							{(latestBiomass?.avgWeightKg ?? 0) * 1000}{" "}
							<span className="text-lg font-semibold text-gray-400">g/ABW</span>
						</p>
					</div>
				</div>

				{/* Daily Feed Dispensed */}
				<div className="rounded-3xl bg-white p-6 shadow-sm border border-gray-100 flex items-center gap-5 transition-transform hover:-translate-y-1">
					<div className="h-16 w-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
						<Activity className="h-8 w-8" />
					</div>
					<div>
						<p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
							Feed Dispensed Today
						</p>
						<p className="text-3xl font-extrabold text-[var(--ofd-base-deep)]">
							{(dailyFeedDispensed / 1000).toFixed(1)}{" "}
							<span className="text-lg font-semibold text-gray-400">kg</span>
						</p>
					</div>
				</div>
			</div>

			{energyDevice && (
				<section className="max-w-md">
					<EnergyControllerCard
						deviceId={energyDevice.id}
						label={energyDevice.label}
						mac={energyDevice.mac}
						initialRelayState={energyDevice.relayState}
						lastSeenAt={energyDevice.lastSeenAt}
					/>
				</section>
			)}
		</div>
	);
}
