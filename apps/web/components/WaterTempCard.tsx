interface WaterTempCardProps {
	tempC: number | null;
	tempOk: boolean;
	updatedAt: Date | null;
	isDeviceOffline?: boolean;
}

export function WaterTempCard({
	tempC,
	tempOk,
	updatedAt,
	isDeviceOffline = false,
}: WaterTempCardProps) {
	const hasReading = tempOk && tempC !== null;
	const isStale = hasReading && isDeviceOffline;

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
					<div className="h-11 w-11 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
						<svg
							className="h-6 w-6"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={2}
							role="img"
							aria-label="Water temperature"
						>
							<title>Water temperature</title>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M14 14.76V3.5a2 2 0 10-4 0v11.26a4 4 0 104 0z"
							/>
						</svg>
					</div>
					<div>
						<p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
							Water Temperature
						</p>
						<h3 className="text-lg font-bold text-[var(--ofd-base-deep)]">
							{hasReading ? `${(tempC as number).toFixed(1)}°C` : "—"}
						</h3>
					</div>
				</div>
				<span
					className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
						isStale
							? "bg-amber-100 text-amber-700"
							: hasReading
								? "bg-green-100 text-green-700"
								: "bg-gray-100 text-gray-600"
					}`}
				>
					<span
						className={`h-2 w-2 rounded-full ${isStale ? "bg-amber-500" : hasReading ? "bg-green-500" : "bg-gray-400"}`}
					/>
					{isStale ? "Stale" : hasReading ? "OK" : "Sensor Offline"}
				</span>
			</div>

			{hasReading ? (
				<div className="rounded-xl bg-gray-50 p-3">
					<p className="text-xs text-gray-500 font-medium">Last updated</p>
					<p className="text-sm font-medium text-gray-700">
						{updatedAt ? formatTimeAgo(updatedAt) : "—"}
					</p>
				</div>
			) : (
				<p className="text-sm text-gray-400 text-center py-4">Sensor offline</p>
			)}
		</div>
	);
}
