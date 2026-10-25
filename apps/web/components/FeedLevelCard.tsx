"use client";

import { getFeedLevelDisplay } from "@/lib/feed-level";

interface FeedLevelCardProps {
	levelPercent: number | null;
	updatedAt: Date | null;
	hopperCapacityG: number | null;
	gramsPerFeeding: number;
	feedsPerDay: number;
	isDeviceOffline?: boolean;
}

export function FeedLevelCard({
	levelPercent,
	updatedAt,
	hopperCapacityG,
	gramsPerFeeding,
	feedsPerDay,
	isDeviceOffline = false,
}: FeedLevelCardProps) {
	const { percent, hasReading, isOffline, isCritical, isLow, daysRemaining } = getFeedLevelDisplay({
		levelPercent,
		isDeviceOffline,
		hopperCapacityG,
		gramsPerFeeding,
		feedsPerDay,
	});

	const barColor = isOffline
		? "bg-gray-400"
		: isCritical
			? "bg-red-500"
			: isLow
				? "bg-amber-500"
				: "bg-emerald-500";

	const formatTimeAgo = (date: Date) => {
		const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	};

	return (
		<div className="rounded-3xl bg-white dark:bg-gray-900 p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 transition-shadow hover:shadow-md">
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-3">
					<div className="h-11 w-11 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
						<svg
							className="h-6 w-6"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={2}
							role="img"
							aria-label="Feed hopper"
						>
							<title>Feed hopper</title>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
							/>
						</svg>
					</div>
					<div>
						<p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							Feed Level
						</p>
						<h3 className="text-lg font-bold text-[var(--ofd-base-deep)]">
							{percent !== null ? `${Math.round(percent)}%` : "—"}
						</h3>
					</div>
				</div>
				<span
					className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
						isOffline
							? "bg-red-100 text-red-700"
							: isCritical
								? "bg-red-100 text-red-700"
								: isLow
									? "bg-amber-100 text-amber-700"
									: hasReading
										? "bg-green-100 text-green-700"
										: "bg-gray-100 text-gray-600"
					}`}
				>
					<span
						className={`h-2 w-2 rounded-full ${
							isOffline
								? "bg-red-500"
								: isCritical
									? "bg-red-500"
									: isLow
										? "bg-amber-500"
										: hasReading
											? "bg-green-500"
											: "bg-gray-400"
						}`}
					/>
					{isOffline
						? "Offline"
						: isCritical
							? "Empty"
							: isLow
								? "Low"
								: hasReading
									? "OK"
									: "No data"}
				</span>
			</div>

			{hasReading ? (
				<>
					<div className="mb-3">
						<div className="h-3 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
							<div
								className={`h-full ${barColor} transition-all rounded-full`}
								style={{ width: `${isOffline ? 0 : Math.max(percent ?? 0, 4)}%` }}
							/>
						</div>
					</div>

					{isOffline && (
						<div className="mb-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
							Device offline — level reading unavailable. Showing resting state.
						</div>
					)}

					<div className="grid grid-cols-2 gap-3">
						<div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
							<p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Days remaining</p>
							<p className="text-sm font-bold text-[var(--ofd-base-deep)]">
								{daysRemaining !== null ? `~${daysRemaining}d` : "—"}
							</p>
						</div>
						<div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
							<p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Last updated</p>
							<p className="text-sm font-medium text-gray-700 dark:text-gray-200">
								{updatedAt ? formatTimeAgo(updatedAt) : "—"}
							</p>
						</div>
					</div>
				</>
			) : (
				<p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
					No level reading yet
				</p>
			)}
		</div>
	);
}
