"use client";

interface FeedLevelCardProps {
	levelPercent: number | null;
	updatedAt: Date | null;
	hopperCapacityG: number | null;
	gramsPerFeeding: number;
	feedsPerDay: number;
}

export function FeedLevelCard({
	levelPercent,
	updatedAt,
	hopperCapacityG,
	gramsPerFeeding,
	feedsPerDay,
}: FeedLevelCardProps) {
	const hasReading = levelPercent !== null;
	const isCritical = hasReading && levelPercent <= 5;
	const isLow = hasReading && levelPercent <= 20;

	const barColor = isCritical ? "bg-red-500" : isLow ? "bg-amber-500" : "bg-emerald-500";

	const dailyConsumption = gramsPerFeeding * feedsPerDay;
	const daysRemaining =
		hasReading && hopperCapacityG && dailyConsumption > 0
			? Math.floor((hopperCapacityG * (levelPercent / 100)) / dailyConsumption)
			: null;

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
		<div className="rounded-3xl bg-white p-6 shadow-sm border border-gray-100 transition-shadow hover:shadow-md">
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
						<p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
							Feed Level
						</p>
						<h3 className="text-lg font-bold text-[var(--ofd-base-deep)]">
							{hasReading ? `${Math.round(levelPercent)}%` : "—"}
						</h3>
					</div>
				</div>
				<span
					className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
						isCritical
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
							isCritical
								? "bg-red-500"
								: isLow
									? "bg-amber-500"
									: hasReading
										? "bg-green-500"
										: "bg-gray-400"
						}`}
					/>
					{isCritical ? "Empty" : isLow ? "Low" : hasReading ? "OK" : "No data"}
				</span>
			</div>

			{hasReading ? (
				<>
					<div className="mb-3">
						<div className="h-3 w-full rounded-full bg-muted overflow-hidden">
							<div
								className={`h-full ${barColor} transition-all rounded-full`}
								style={{ width: `${Math.max(levelPercent, 4)}%` }}
							/>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="rounded-xl bg-gray-50 p-3">
							<p className="text-xs text-gray-500 font-medium">Days remaining</p>
							<p className="text-sm font-bold text-[var(--ofd-base-deep)]">
								{daysRemaining !== null ? `~${daysRemaining}d` : "—"}
							</p>
						</div>
						<div className="rounded-xl bg-gray-50 p-3">
							<p className="text-xs text-gray-500 font-medium">Last updated</p>
							<p className="text-sm font-medium text-gray-700">
								{updatedAt ? formatTimeAgo(updatedAt) : "—"}
							</p>
						</div>
					</div>
				</>
			) : (
				<p className="text-sm text-gray-400 text-center py-4">No level reading yet</p>
			)}
		</div>
	);
}
