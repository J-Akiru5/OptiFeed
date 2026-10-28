import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The farmer control room (issue #188, decision E14).
 *
 * Above 1280 px the dashboard is one viewport: the page itself never scrolls,
 * the left column holds the feeding strip, the pond overview and the charts,
 * and only the right rail scrolls. Below 1280 px the same blocks stack into the
 * ordinary scrolling dashboard, so a phone keeps the familiar layout.
 *
 * `ControlRoomRail` is `display: contents` under `xl`. That lets the rail's
 * children take part in the page's mobile column — where their `order` classes
 * place them next to the blocks they belong with — while the same children sit
 * inside a single scroll container on a wide screen. One DOM tree, no duplicate
 * controls, and the help centre still finds its anchors once.
 */

interface ControlRoomLayoutProps {
	children: ReactNode;
	className?: string;
}

/**
 * The page shell. Height is the viewport minus the 4 rem header and the
 * dashboard `main` padding (2 rem top and bottom at `xl`).
 */
export function ControlRoomLayout({ children, className }: ControlRoomLayoutProps) {
	return (
		<div
			className={cn(
				"flex w-full min-w-0 flex-col gap-6 animate-in fade-in duration-150",
				"xl:grid xl:h-[calc(100dvh-8rem)] xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-[auto_minmax(0,1fr)_auto] xl:gap-4 xl:overflow-hidden",
				className,
			)}
		>
			{children}
		</div>
	);
}

interface ControlRoomRailProps {
	/** Accessible name for the independently scrolling column. */
	label: string;
	children: ReactNode;
	className?: string;
}

export function ControlRoomRail({ label, children, className }: ControlRoomRailProps) {
	return (
		<aside
			aria-label={label}
			className={cn(
				"contents",
				// #269: the rail scrolls vertically only. A wide child used to turn
				// the implicit `overflow-x` into a horizontal scrollbar; the rail
				// must never scroll sideways, so it is pinned to x-hidden as well.
				"xl:col-start-2 xl:row-span-3 xl:row-start-1 xl:flex xl:min-h-0 xl:min-w-0 xl:flex-col xl:gap-3 xl:overflow-x-hidden xl:overflow-y-auto xl:pr-1 xl:pb-2",
				className,
			)}
		>
			{children}
		</aside>
	);
}

interface ControlPanelProps {
	title: string;
	icon?: LucideIcon;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
}

/** A titled card in the rail (or a stacked block below `xl`). */
export function ControlPanel({
	title,
	icon: Icon,
	action,
	children,
	className,
}: ControlPanelProps) {
	return (
		<section
			className={cn(
				"min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900",
				className,
			)}
		>
			<div className="mb-3 flex items-start justify-between gap-2">
				<h2 className="flex min-w-0 items-center gap-2 text-[11px] font-black uppercase tracking-wider text-[#0A3D62] dark:text-[#5b9bd5]">
					{Icon && <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />}
					<span className="truncate">{title}</span>
				</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

/**
 * Mobile stacking order, then `xl:order-none` so the rail keeps its DOM order
 * inside the right column. Values are static strings on purpose: Tailwind only
 * generates the utilities it can see in the source.
 */
export const CONTROL_ROOM_ORDER = {
	alert: "order-[1] xl:order-none",
	header: "order-[2] xl:order-none",
	feedNow: "order-[3] xl:order-none",
	hero: "order-[4] xl:order-none",
	canvas: "order-[5] xl:order-none",
	charts: "order-[6] xl:order-none",
	pond: "order-[7] xl:order-none",
	device: "order-[8] xl:order-none",
	water: "order-[9] xl:order-none",
	alerts: "order-[10] xl:order-none",
	advisorSummary: "order-[11] xl:order-none",
	advisorFull: "order-[12] xl:order-none",
	growOut: "order-[13] xl:order-none",
	feedings: "order-[14] xl:order-none",
	biomass: "order-[15] xl:order-none",
	stats: "order-[16] xl:order-none",
	controller: "order-[17] xl:order-none",
} as const;

/** Column placement for the three blocks that make up the left-hand view. */
export const CONTROL_ROOM_MAIN = {
	hero: "xl:col-start-1 xl:row-start-1",
	canvas: "xl:col-start-1 xl:row-start-2 xl:min-h-0",
	charts: "xl:col-start-1 xl:row-start-3",
} as const;
