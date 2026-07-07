import prisma from "@/lib/prisma";
import { CalendarDays, CheckCircle2, Clock, XCircle } from "lucide-react";

export const revalidate = 0;

export default async function HistoryPage() {
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

	const events = await prisma.feedingEvent.findMany({
		where: { deviceId: device.id },
		orderBy: { scheduledTime: "desc" },
		take: 50,
	});

	const totalDispensed = events
		.filter((e) => e.status === "completed")
		.reduce((sum, e) => sum + e.dispensedVolumeG, 0);

	const missedCount = events.filter((e) => e.status === "missed").length;

	const formatDate = (d: Date) =>
		new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(
			d,
		);

	const formatTime = (d: Date) =>
		new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d);

	return (
		<div className="space-y-8 pb-20 animate-in fade-in duration-500">
			<header>
				<h1 className="text-3xl font-extrabold tracking-tight text-[var(--ofd-base-deep)]">
					Feeding History
				</h1>
				<p className="text-gray-500 mt-1">Recent feeding events for {pond.name}</p>
			</header>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				<div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex items-center gap-4">
					<div className="h-14 w-14 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center">
						<CheckCircle2 className="h-7 w-7" />
					</div>
					<div>
						<p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
							Recent Feed Dispensed
						</p>
						<p className="text-2xl font-extrabold text-[var(--ofd-base-deep)]">
							{(totalDispensed / 1000).toFixed(1)}{" "}
							<span className="text-base text-gray-400 font-medium">kg</span>
						</p>
					</div>
				</div>

				<div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex items-center gap-4">
					<div className="h-14 w-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center">
						<XCircle className="h-7 w-7" />
					</div>
					<div>
						<p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
							Missed Feeds
						</p>
						<p className="text-2xl font-extrabold text-[var(--ofd-base-deep)]">
							{missedCount} <span className="text-base text-gray-400 font-medium">events</span>
						</p>
					</div>
				</div>
			</div>

			<div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
				<div className="p-6 border-b border-gray-100 bg-gray-50/50">
					<h3 className="font-bold text-gray-800 flex items-center gap-2">
						<CalendarDays className="h-5 w-5 text-gray-400" /> Event Log (Last 50)
					</h3>
				</div>
				<div className="divide-y divide-gray-100">
					{events.map((event) => (
						<div
							key={event.id}
							className="p-4 sm:p-6 flex items-center justify-between hover:bg-gray-50 transition-colors"
						>
							<div className="flex items-center gap-4">
								{event.status === "completed" ? (
									<div className="h-10 w-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
										<CheckCircle2 className="h-5 w-5" />
									</div>
								) : (
									<div className="h-10 w-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
										<XCircle className="h-5 w-5" />
									</div>
								)}
								<div>
									<p className="font-semibold text-gray-900 flex items-center gap-2">
										{formatDate(event.scheduledTime)}
										<span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 flex items-center gap-1">
											<Clock className="h-3 w-3" /> {formatTime(event.scheduledTime)}
										</span>
									</p>
									<p className="text-sm text-gray-500 mt-0.5">
										{event.status === "completed"
											? "Successfully dispensed feed"
											: "Feeder was offline or empty"}
									</p>
								</div>
							</div>
							<div className="text-right">
								{event.status === "completed" ? (
									<p className="font-bold text-gray-900">{event.dispensedVolumeG}g</p>
								) : (
									<p className="font-bold text-red-500">0g</p>
								)}
							</div>
						</div>
					))}

					{events.length === 0 && (
						<div className="p-10 text-center text-gray-500">No feeding events found.</div>
					)}
				</div>
			</div>
		</div>
	);
}
