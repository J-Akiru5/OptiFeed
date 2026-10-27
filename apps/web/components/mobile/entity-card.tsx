import { Link } from "@/i18n/routing";
import type { DeviceListStatus } from "@/lib/mobile-list";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export const STATUS_DOT: Record<DeviceListStatus, string> = {
	online: "bg-[#1E7B34] dark:bg-[#4ade80]",
	alarm: "bg-[#B45309] dark:bg-[#fbbf24]",
	offline: "bg-[#9AA7B1] dark:bg-gray-500",
};

const STATUS_TEXT: Record<DeviceListStatus, string> = {
	online: "text-[#1E7B34] dark:text-[#4ade80]",
	alarm: "text-[#B45309] dark:text-[#fbbf24]",
	offline: "text-[#3D5568] dark:text-gray-400",
};

export interface EntityMetric {
	label: string;
	value: ReactNode;
}

/**
 * The large list card used by the mobile ponds and feeders lists (E26).
 *
 * It follows the reference layout: a status dot and the name on the left, a
 * thumbnail on the right, then exactly three key metrics in a labelled row and
 * the row's own actions underneath. There are no photographs in the product
 * yet, so the thumbnail is the entity's icon tile; the slot is where a pond
 * photo would go.
 *
 * The avatar/photo is decorative and `aria-hidden`; the status carries a text
 * label as well as the dot, so colour is never the only signal (WCAG 1.4.1).
 */
export function EntityCard({
	status,
	statusLabel,
	title,
	subtitle,
	href,
	icon: Icon,
	metrics,
	children,
	className,
}: {
	status: DeviceListStatus;
	/** Translated status word ("Online", "Alarm", "Offline"). */
	statusLabel: string;
	title: string;
	subtitle?: ReactNode;
	href?: string;
	icon: LucideIcon;
	metrics: EntityMetric[];
	/** Footer: the card's own actions. */
	children?: ReactNode;
	className?: string;
}) {
	const heading = href ? (
		<Link
			href={href}
			className="min-w-0 font-black break-words text-[#0A3D62] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-gray-100 dark:focus-visible:outline-[#8fc0ea]"
		>
			{title}
		</Link>
	) : (
		<span className="min-w-0 font-black break-words text-[#0A3D62] dark:text-gray-100">
			{title}
		</span>
	);

	return (
		<li
			className={cn(
				"rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900",
				className,
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-2">
						<span
							aria-hidden="true"
							className={cn("h-2.5 w-2.5 rounded-full", STATUS_DOT[status])}
						/>
						<span className="text-base leading-tight">{heading}</span>
					</div>
					<p
						className={cn(
							"mt-1 flex items-center gap-1 text-[10px] font-black tracking-wider uppercase",
							STATUS_TEXT[status],
						)}
					>
						{statusLabel}
					</p>
					{subtitle && (
						<p className="mt-1 truncate text-[11px] font-bold text-[#3D5568] dark:text-gray-400">
							{subtitle}
						</p>
					)}
				</div>
				<span
					aria-hidden="true"
					className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#0A3D62]/8 dark:bg-white/10"
				>
					<Icon className="h-7 w-7 text-[#0A3D62] dark:text-[#8fc0ea]" />
				</span>
			</div>

			<dl className="mt-3 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
				{metrics.slice(0, 3).map((metric) => (
					<div key={metric.label} className="min-w-0">
						<dt className="truncate text-[9px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400">
							{metric.label}
						</dt>
						<dd className="mt-0.5 truncate text-sm font-black text-[#0A3D62] tabular-nums dark:text-gray-100">
							{metric.value}
						</dd>
					</div>
				))}
			</dl>

			{children && (
				<div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
					{children}
				</div>
			)}
		</li>
	);
}
