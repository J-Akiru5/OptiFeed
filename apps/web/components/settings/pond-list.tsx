import { dashboardFocus, dashboardLabel } from "@/components/dashboard/dashboard-classes";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-ui";
import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Droplets } from "lucide-react";

export interface PondListPond {
	id: string;
	name: string;
}

export interface PondListProps {
	/** Ponds assigned to the farm, already scoped by the caller. */
	ponds: PondListPond[];
	/** Section label above the list, e.g. "Ponds". */
	label: string;
	/** Already-formatted heading with the count, e.g. "Ponds (3)". */
	countLabel: string;
	/** Empty-state headline, translated by the caller. */
	emptyTitle: string;
	/** Empty-state explanation, translated by the caller. */
	emptyHint: string;
	/** Label for the link that opens the pond management page. */
	manageLabel: string;
	/** Where "manage" goes. The link only renders when there are ponds. */
	manageHref?: string;
	className?: string;
}

/**
 * The farm's pond list on the settings page (#484).
 *
 * The dashboard used to render every pond as an unbounded list, so a farm with
 * many ponds pushed the whole card down the page. The list is now capped at
 * `max-h-64` and scrolls on its own, which keeps the card's height predictable
 * without hiding a pond: the same rows are all still there, reachable with the
 * wheel or the keyboard (the scroll box takes focus).
 *
 * Presentational on purpose: every string, including the formatted count and
 * the empty state, arrives as a prop. The settings page owns translation and
 * the pond count, so this component stays a plain server component with no
 * i18n runtime and no plural logic.
 */
export function PondList({
	ponds,
	label,
	countLabel,
	emptyTitle,
	emptyHint,
	manageLabel,
	manageHref,
	className,
}: PondListProps) {
	const hasPonds = ponds.length > 0;

	return (
		<div className={cn("min-w-0", className)}>
			<div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<p className={cn(dashboardLabel, "mb-0")}>{label}</p>
				<h3 className="text-xs font-black tabular-nums text-[#0A3D62] dark:text-gray-100">
					{countLabel}
				</h3>
			</div>

			{hasPonds ? (
				<>
					<ul
						aria-label={label}
						// biome-ignore lint/a11y/noNoninteractiveTabindex: the list scrolls at max-h-64, so keyboard users need to focus it to scroll (WCAG 2.1.1).
						tabIndex={0}
						className={cn("max-h-64 space-y-2 overflow-y-auto pr-1", dashboardFocus)}
					>
						{ponds.map((pond) => (
							<li
								key={pond.id}
								className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-2 text-sm font-bold text-[#0A3D62] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
							>
								<Droplets
									aria-hidden="true"
									className="h-4 w-4 shrink-0 text-[#0A3D62] dark:text-[#5b9bd5]"
								/>
								<span className="min-w-0 truncate" title={pond.name}>
									{pond.name}
								</span>
							</li>
						))}
					</ul>
					{manageHref && (
						<Link
							href={manageHref}
							className={cn(
								"mt-2 inline-flex min-h-11 items-center rounded-lg text-xs font-black text-[#C2410C] underline-offset-2 hover:underline dark:text-[#ff8a5c]",
								dashboardFocus,
							)}
						>
							{manageLabel}
						</Link>
					)}
				</>
			) : (
				<DashboardEmptyState
					icon={Droplets}
					title={emptyTitle}
					description={emptyHint}
					className="px-4 py-8"
				/>
			)}
		</div>
	);
}
