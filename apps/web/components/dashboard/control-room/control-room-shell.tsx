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
 * The height comes from `ofd-control-room` (globals.css), which subtracts the
 * header and the pane padding from `100dvh` and steps the density down on short
 * laptop viewports, so the whole room fits at 1366x768 and above (#399).
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
 * Full-bleed band for the stacked dashboard below `xl` (#476).
 *
 * The dashboard page applies this to each order wrapper, so every stacked
 * section carries its own hairline and padding while the room itself has none.
 */
export const CONTROL_ROOM_MOBILE_BAND =
	"max-xl:border-b max-xl:border-[#E6ECE9] max-xl:bg-white max-xl:px-4 max-xl:py-4 dark:max-xl:border-gray-800 dark:max-xl:bg-gray-900";

/**
 * The page shell. Height comes from `ofd-control-room`: the viewport minus the
 * dashboard header and the `main` pane padding, with height-based density tiers.
 *
 * `relative` is load-bearing (#399): the blocks below carry absolutely
 * positioned helpers (the `.sr-only` text alternatives and the charts' hidden
 * tables). Without a positioned ancestor inside the shell, those 1 px boxes are
 * positioned against `main` and escape the room's `overflow-hidden`, which
 * leaves the page with a phantom scroll range even when everything fits.
 *
 * Below `xl` the shell cancels the `main` pane padding (`-mx-4 -mt-4`) and drops
 * its stacking gap, so the page-owned bands run edge to edge and sit flush
 * (#476). Desktop geometry is untouched.
 */
export function ControlRoomLayout({ children, className }: ControlRoomLayoutProps) {
	return (
		<div
			className={cn(
				"ofd-control-room relative flex w-full min-w-0 flex-col gap-6 max-xl:-mx-4 max-xl:-mt-4 max-xl:gap-0 animate-in fade-in duration-150",
				"xl:grid xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-[auto_minmax(0,1fr)_auto] xl:overflow-hidden",
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
				// `xl:relative` keeps the rail's own absolutely positioned helpers
				// (`.sr-only` text) inside its scroll box, so they cannot add a
				// phantom scroll range to the page (#399).
				"xl:relative xl:col-start-2 xl:row-span-3 xl:row-start-1 xl:flex xl:min-h-0 xl:min-w-0 xl:flex-col xl:gap-3 xl:overflow-x-hidden xl:overflow-y-auto xl:pr-1 xl:pb-2",
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

/**
 * A titled card in the rail (or a stacked block below `xl`).
 *
 * Below `xl` the card chrome is flattened into a flat section: the page's band
 * supplies the background and hairline, so radius, border, fill and shadow are
 * removed and the inner padding goes to zero (#476).
 */
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
				"min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm max-xl:rounded-none max-xl:border-0 max-xl:bg-transparent max-xl:p-0 max-xl:shadow-none dark:border-gray-700/60 dark:bg-gray-900",
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
