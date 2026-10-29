import { Link } from "@/i18n/routing";
import { LIST_ORDERS, type ListOrder } from "@/lib/mobile-list";
import { buildPageHref } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { ArrowUpDown, Flag } from "lucide-react";

export interface ListChipsLabels {
	/** "Order" — accessible name of the ordering group. */
	order: string;
	newest: string;
	name: string;
	status: string;
	/** "Only what needs attention" */
	attention: string;
	/** "Filters apply to the items on this page." */
	hint: string;
}

const chipBase =
	"inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-[11px] font-black whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] focus-visible:ring-offset-2 dark:focus-visible:ring-[#8fc0ea]";
const chipIdle =
	"border-gray-200 bg-white text-[#3D5568] hover:bg-[#F4F7F6] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800";
const chipActive =
	"border-[#C2410C] bg-[#C2410C] text-white dark:border-[#ff8a5c] dark:bg-[#ff8a5c] dark:text-[#0A1220]";

/**
 * The chips row under the status strip (E26): "order by" plus a one-tap
 * "needs attention" filter.
 *
 * Ordering and filtering are query parameters, so they survive navigation and
 * work without JavaScript. `newest` keeps the order the list action returned.
 */
export function ListChips({
	basePath,
	params = {},
	order,
	attention,
	labels,
}: {
	basePath: string;
	params?: Record<string, string | undefined>;
	order: ListOrder;
	attention: boolean;
	labels: ListChipsLabels;
}) {
	const orderLabels: Record<ListOrder, string> = {
		newest: labels.newest,
		name: labels.name,
		status: labels.status,
	};

	return (
		<div className="space-y-1.5 lg:hidden">
			<div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
				<span className="flex shrink-0 items-center gap-1 text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400">
					<ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5" />
					{labels.order}
				</span>
				{LIST_ORDERS.map((value) => (
					<Link
						key={value}
						href={buildPageHref(basePath, { ...params, order: value }, 1)}
						aria-current={value === order ? "true" : undefined}
						className={cn(chipBase, value === order ? chipActive : chipIdle)}
					>
						{orderLabels[value]}
					</Link>
				))}
				<Link
					href={buildPageHref(basePath, { ...params, attention: attention ? undefined : "1" }, 1)}
					// The chip is a link that navigates to a filtered list, so its
					// state is `aria-current` — `aria-pressed` is not allowed on the
					// link role (axe `aria-allowed-attr`) and would tell a screen
					// reader this is a toggle button that does not navigate.
					aria-current={attention ? "true" : undefined}
					className={cn(chipBase, attention ? chipActive : chipIdle)}
				>
					<Flag aria-hidden="true" className="h-3.5 w-3.5" />
					{labels.attention}
				</Link>
			</div>
			{(order !== "newest" || attention) && (
				<p className="text-[10px] font-bold text-[#3D5568] dark:text-gray-400">{labels.hint}</p>
			)}
		</div>
	);
}
