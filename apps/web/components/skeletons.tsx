export function Skeleton({ className }: { className?: string }) {
	return (
		<div
			aria-hidden="true"
			className={`animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 ${className ?? ""}`}
		/>
	);
}

function SkeletonStatus({ label }: { label?: string }) {
	return (
		<output className="sr-only" aria-live="polite">
			{label ?? ""}
		</output>
	);
}

const pageShell = "space-y-6 pb-20 animate-in fade-in duration-500";

/** Header block shared by the generic page skeletons. */
function SkeletonPageHeader() {
	return (
		<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
			<div className="flex items-start gap-3">
				<Skeleton className="h-11 w-11 shrink-0 rounded-2xl" />
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-4 w-72 max-w-full" />
				</div>
			</div>
			<Skeleton className="h-11 w-32 rounded-xl" />
		</div>
	);
}

/** Table/list page: header, filters and rows. Used by growth, audit, notifications. */
export function ListPageSkeleton({ label }: { label?: string }) {
	return (
		<div aria-busy="true" className={pageShell}>
			<SkeletonStatus label={label} />
			<SkeletonPageHeader />
			<div className="flex flex-wrap gap-2">
				{[1, 2, 3, 4].map((i) => (
					<Skeleton key={i} className="h-11 w-24 rounded-full" />
				))}
			</div>
			<div className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
				{[1, 2, 3, 4, 5].map((i) => (
					<div
						key={i}
						className="flex items-center justify-between gap-4 border-b border-gray-50 p-4 last:border-0 dark:border-gray-800"
					>
						<div className="flex items-center gap-3">
							<Skeleton className="h-10 w-10 rounded-xl" />
							<div className="space-y-1.5">
								<Skeleton className="h-4 w-32" />
								<Skeleton className="h-3 w-48 max-w-full" />
							</div>
						</div>
						<Skeleton className="h-5 w-16" />
					</div>
				))}
			</div>
		</div>
	);
}

/** Form page: header and a tall form card. Used by schedule and biomass logging. */
export function FormPageSkeleton({ label }: { label?: string }) {
	return (
		<div aria-busy="true" className={pageShell}>
			<SkeletonStatus label={label} />
			<SkeletonPageHeader />
			<div className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/50 dark:bg-gray-900 sm:p-6">
				<div className="grid gap-4 sm:grid-cols-2">
					{[1, 2, 3, 4].map((i) => (
						<div key={i} className="space-y-2">
							<Skeleton className="h-3 w-24" />
							<Skeleton className="h-11 w-full rounded-xl" />
						</div>
					))}
				</div>
				<div className="mt-6 space-y-2">
					<Skeleton className="h-3 w-32" />
					<Skeleton className="h-24 w-full rounded-xl" />
				</div>
				<div className="mt-6 flex justify-end gap-2">
					<Skeleton className="h-11 w-24 rounded-xl" />
					<Skeleton className="h-11 w-32 rounded-xl" />
				</div>
			</div>
		</div>
	);
}

/** Fixed keys for the month-grid placeholder; the grid never reorders. */
const CALENDAR_SKELETON_CELLS = Array.from({ length: 35 }, (_, index) => `cell-${index}`);

/** Calendar page: header, summary strip, month grid and upcoming list. */
export function CalendarPageSkeleton({ label }: { label?: string }) {
	return (
		<div aria-busy="true" className={pageShell}>
			<SkeletonStatus label={label} />
			<SkeletonPageHeader />
			<div className="flex flex-col gap-4 xl:flex-row">
				<div className="flex-1 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
					<div className="mb-4 flex flex-wrap gap-2">
						{[1, 2, 3, 4].map((i) => (
							<Skeleton key={i} className="h-8 w-20 rounded-full" />
						))}
					</div>
					<div className="grid grid-cols-7 gap-1">
						{CALENDAR_SKELETON_CELLS.map((cell) => (
							<Skeleton key={cell} className="h-14 w-full rounded-lg" />
						))}
					</div>
				</div>
				<div className="w-full rounded-3xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/50 dark:bg-gray-900 xl:w-[300px]">
					<Skeleton className="h-5 w-32" />
					<div className="mt-4 space-y-3">
						{[1, 2, 3, 4].map((i) => (
							<div key={i} className="space-y-1.5">
								<Skeleton className="h-4 w-40" />
								<Skeleton className="h-3 w-24" />
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

export function DashboardSkeleton({ label }: { label?: string } = {}) {
	return (
		<div aria-busy="true" className="space-y-6 pb-20 animate-in fade-in duration-500">
			<SkeletonStatus label={label} />
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
