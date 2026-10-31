import { Link } from "@/i18n/routing";
import { DEVICE_STATUS_FILTERS, type DeviceStatusFilter } from "@/lib/mobile-list";
import { buildPageHref } from "@/lib/pagination";
import { cn } from "@/lib/utils";

const DOT: Record<DeviceStatusFilter, string> = {
	all: "bg-[#0A3D62] dark:bg-[#8fc0ea]",
	online: "bg-[#1E7B34] dark:bg-[#4ade80]",
	alarm: "bg-[#B45309] dark:bg-[#fbbf24]",
	offline: "bg-[#9AA7B1] dark:bg-gray-500",
};

/**
 * The tappable All / Online / Alarm / Offline summary under the mobile header
 * band (E26, modelled on the reference control-room app).
 *
 * Each tile is a link, so the filter survives a reload, the back button and the
 * numbered pagination (the page passes `params` through to `Pagination`). It is
 * hidden from `lg` up: the desktop tables keep their own columns.
 */
export function StatusStrip({
	counts,
	active,
	basePath,
	params = {},
	label,
	labels,
}: {
	counts: Record<DeviceStatusFilter, number>;
	active: DeviceStatusFilter;
	basePath: string;
	/** Current query parameters, so a filter change keeps search and ordering. */
	params?: Record<string, string | undefined>;
	/** Accessible name for the filter group. */
	label: string;
	labels: Record<DeviceStatusFilter, string>;
}) {
	return (
		<nav aria-label={label} className="lg:hidden">
			<ul className="grid grid-cols-4 gap-1.5">
				{DEVICE_STATUS_FILTERS.map((status) => {
					const isActive = status === active;
					const href = buildPageHref(
						basePath,
						{ ...params, status: status === "all" ? undefined : status },
						1,
					);

					return (
						<li key={status}>
							<Link
								href={href}
								aria-current={isActive ? "page" : undefined}
								className={cn(
									"flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] focus-visible:ring-offset-2 dark:focus-visible:ring-[#8fc0ea]",
									isActive
										? "border-[#0A3D62] bg-[#0A3D62] text-white dark:border-[#5b9bd5] dark:bg-[#5b9bd5]"
										: "border-gray-200 bg-white text-[#0A3D62] hover:bg-[#F4F7F6] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800",
								)}
							>
								<span className="flex items-center gap-1">
									<span
										aria-hidden="true"
										className={cn("h-1.5 w-1.5 rounded-full", DOT[status])}
									/>
									<span className="text-base leading-none font-black tabular-nums">
										{counts[status]}
									</span>
								</span>
								<span className="w-full truncate text-[10px] leading-tight font-black uppercase">
									{labels[status]}
								</span>
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
