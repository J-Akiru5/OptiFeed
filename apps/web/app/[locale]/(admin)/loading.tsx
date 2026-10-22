const SKELETON_ROWS = ["s1", "s2", "s3"];

export default function AdminLoading() {
	return (
		<div className="space-y-6 p-6">
			<div className="h-8 w-56 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
			<div className="grid gap-4 md:grid-cols-3">
				{SKELETON_ROWS.map((row) => (
					<div key={row} className="h-28 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-700" />
				))}
			</div>
			<div className="h-72 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-700" />
		</div>
	);
}
