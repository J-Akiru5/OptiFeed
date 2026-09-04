export function Skeleton({ className }: { className?: string }) {
	return (
		<div className={`animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 ${className ?? ""}`} />
	);
}

export function DashboardSkeleton() {
	return (
		<div className="space-y-6 pb-20 animate-in fade-in duration-500">
			{/* Welcome row */}
			<div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
				<div className="space-y-2">
					<Skeleton className="h-8 w-64" />
					<Skeleton className="h-4 w-48" />
				</div>
				<Skeleton className="h-12 w-40 rounded-xl" />
			</div>

			{/* Bento Grid */}
			<div className="grid grid-cols-1 md:grid-cols-12 gap-6">
				{/* Hero tile */}
				<div className="col-span-1 md:col-span-8 bg-white dark:bg-gray-900 rounded-[32px] p-6 md:p-8 shadow-md border border-gray-100 dark:border-gray-700/50 min-h-[300px]">
					<Skeleton className="h-4 w-24 mb-4" />
					<Skeleton className="h-16 md:h-24 w-48 mb-4" />
					<div className="flex gap-3 mb-6">
						<Skeleton className="h-6 w-20 rounded-full" />
						<Skeleton className="h-4 w-32" />
					</div>
					<div className="flex gap-8 pt-6 border-t border-gray-100 dark:border-gray-700">
						<div className="space-y-1">
							<Skeleton className="h-3 w-16" />
							<Skeleton className="h-6 w-12" />
						</div>
						<div className="space-y-1">
							<Skeleton className="h-3 w-16" />
							<Skeleton className="h-6 w-12" />
						</div>
					</div>
				</div>

				{/* FCR tile */}
				<div className="col-span-1 md:col-span-4 bg-[#0A3D62] rounded-[32px] p-6 md:p-8 min-h-[300px]">
					<Skeleton className="h-3 w-20 bg-white/20 mb-2" />
					<Skeleton className="h-16 w-24 bg-white/20 mb-4" />
					<Skeleton className="h-3 w-32 bg-white/10" />
				</div>

				{/* Small tiles */}
				{[1, 2, 3].map((i) => (
					<div
						key={i}
						className="col-span-1 md:col-span-4 bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 flex items-center gap-5"
					>
						<Skeleton className="w-14 h-14 rounded-2xl shrink-0" />
						<div className="space-y-2 flex-1">
							<Skeleton className="h-3 w-20" />
							<Skeleton className="h-5 w-16" />
							<Skeleton className="h-3 w-24" />
						</div>
					</div>
				))}

				{/* Feeding logs */}
				<div className="col-span-1 md:col-span-12 bg-white dark:bg-gray-900 rounded-[32px] p-6 md:p-8 shadow-md border border-gray-100 dark:border-gray-700/50">
					<div className="flex justify-between items-center mb-6">
						<div className="space-y-1">
							<Skeleton className="h-5 w-36" />
							<Skeleton className="h-3 w-24" />
						</div>
						<Skeleton className="h-4 w-20" />
					</div>
					<div className="space-y-3">
						{[1, 2, 3].map((i) => (
							<div
								key={i}
								className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-2xl"
							>
								<div className="flex items-center gap-4">
									<Skeleton className="w-10 h-10 rounded-xl" />
									<div className="space-y-1">
										<Skeleton className="h-4 w-16" />
										<Skeleton className="h-3 w-24" />
									</div>
								</div>
								<div className="flex items-center gap-4">
									<Skeleton className="h-4 w-10" />
									<Skeleton className="h-6 w-20 rounded-full" />
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

export function SettingsSkeleton() {
	return (
		<div className="mx-auto max-w-4xl space-y-8 animate-in fade-in duration-500">
			<div className="space-y-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-64" />
			</div>
			{[1, 2, 3].map((i) => (
				<div
					key={i}
					className="rounded-2xl border border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-900 p-6 shadow-sm"
				>
					<div className="mb-6 border-b border-gray-100 dark:border-gray-700 pb-4 space-y-1">
						<Skeleton className="h-5 w-32" />
						<Skeleton className="h-3 w-48" />
					</div>
					<div className="space-y-4">
						<div className="flex justify-between items-center">
							<div className="space-y-1">
								<Skeleton className="h-4 w-36" />
								<Skeleton className="h-3 w-48" />
							</div>
							<Skeleton className="h-6 w-11 rounded-full" />
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
