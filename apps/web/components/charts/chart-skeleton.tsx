import { cn } from "@/lib/utils";

/**
 * Loading placeholder for a chart (#629).
 *
 * A chart that streams in behind `Suspense` or a client-only import still needs
 * to reserve the plot area, so the page does not jump when the SVG arrives. The
 * label is localized and announced once, not on every pulse.
 */
export function ChartSkeleton({
	height = 220,
	label,
	className,
}: {
	height?: number | string;
	label: string;
	className?: string;
}) {
	return (
		<output
			aria-label={label}
			className={cn(
				"mt-4 block w-full overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800",
				className,
			)}
			style={{ height }}
		>
			<span className="sr-only">{label}</span>
			<div
				aria-hidden="true"
				className="h-full w-full animate-pulse rounded-xl bg-gradient-to-r from-gray-100 via-gray-200 to-gray-100 motion-reduce:animate-none dark:from-gray-800 dark:via-gray-700 dark:to-gray-800"
			/>
		</output>
	);
}
