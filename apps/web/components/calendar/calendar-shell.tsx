import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Shared calendar shell (#298).
 *
 * Every calendar view in the app — the farmer Calendar & Harvest page, the
 * tenant-admin calendar and the platform calendar — is built from these parts,
 * so the page owns one layout contract instead of three near-copies:
 *
 * - `CalendarPageShell` is the page root. Above `xl` it is exactly one viewport
 *   tall (the app header and the dashboard `main` padding are subtracted) and
 *   clips overflow, so the document itself never scrolls. Below `xl` it keeps
 *   the ordinary scrolling page.
 * - `CalendarWorkbench` is the row that holds the grid and the side pane. It is
 *   a column on small screens and a two-column row from `xl` up.
 * - `CalendarSurface` is the calendar card. Its toolbar is fixed, its body owns
 *   the remaining height, and the grid fills that body at every size.
 * - `CalendarSidePane` is the only part that scrolls on a wide screen.
 * - `CalendarSidePanel` is a titled card inside that pane.
 *
 * Height chain (>= xl): viewport − 4rem header − 2rem main padding top/bottom
 * (`control-room-shell.tsx` uses the same 8rem constant). The page header and
 * any alerts are `flex-none`; the workbench takes `min-h-0 flex-1`; the surface
 * body is `min-h-0 flex-1`; FullCalendar itself is `height="100%"` against a
 * wrapper that is `h-full` at this breakpoint. Every step is a definite height
 * or a `min-h-0` flex child, which is what stops the grid from pushing the page
 * taller than the viewport.
 *
 * Pages that render layout chrome of their own above the shell (for example the
 * farmer dashboard's global "Back to dashboard" link) set `reserveBackLink` so
 * the extra 2.25rem is subtracted as well; otherwise the shell would overflow
 * by exactly that much.
 */

interface CalendarPageShellProps {
	/** Page heading block. Stays fixed; it never scrolls with the grid. */
	header?: ReactNode;
	/**
	 * Reserve the space taken by the dashboard layout's global back link
	 * (`text-sm` line + `mb-4`, 2.25rem). Only `/dashboard/calendar` has it.
	 */
	reserveBackLink?: boolean;
	children: ReactNode;
	className?: string;
}

export function CalendarPageShell({
	header,
	reserveBackLink = false,
	children,
	className,
}: CalendarPageShellProps) {
	return (
		<div
			className={cn(
				"mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-4 [contain:inline-size] animate-in fade-in duration-150",
				reserveBackLink ? "xl:h-[calc(100dvh-10.25rem)]" : "xl:h-[calc(100dvh-8rem)]",
				"xl:gap-4 xl:overflow-hidden",
				className,
			)}
		>
			{header ? <div className="flex flex-none flex-col gap-4">{header}</div> : null}
			<div className="flex min-h-0 flex-1 flex-col gap-4">{children}</div>
		</div>
	);
}

interface CalendarWorkbenchProps {
	children: ReactNode;
	className?: string;
}

/** Grid plus side pane: stacked below `xl`, side by side above it. */
export function CalendarWorkbench({ children, className }: CalendarWorkbenchProps) {
	return (
		<div className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-4 xl:flex-row", className)}>
			{children}
		</div>
	);
}

interface CalendarSurfaceProps {
	/** Accessible name for the calendar region, e.g. "Pond calendar". */
	label: string;
	/** Filters, selects, legends and page actions above the grid. */
	toolbar: ReactNode;
	/** Shows the top loading bar and marks the region busy. */
	busy?: boolean;
	children: ReactNode;
	className?: string;
}

/**
 * The calendar card. The toolbar keeps its natural height and the grid below it
 * receives every remaining pixel: `min-h-0` on both the card and the body is
 * required, otherwise the grid's intrinsic height wins and the page scrolls.
 */
export function CalendarSurface({
	label,
	toolbar,
	busy = false,
	children,
	className,
}: CalendarSurfaceProps) {
	return (
		<section
			aria-label={label}
			className={cn(
				"flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-gray-100 bg-white shadow-sm dark:border-gray-700/60 dark:bg-gray-900",
				className,
			)}
		>
			<div className="flex flex-none flex-col gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
				{toolbar}
			</div>
			<div
				className="relative min-h-0 flex-1 px-3 pb-3 pt-2 sm:px-4"
				aria-busy={busy ? true : undefined}
			>
				{busy ? (
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-x-3 top-0 z-10 h-0.5 overflow-hidden rounded-full bg-[#0A3D62]/10 dark:bg-white/10"
					>
						<div className="h-full w-1/3 animate-pulse rounded-full bg-[#0A3D62] dark:bg-[#5b9bd5]" />
					</div>
				) : null}
				{/* Mobile keeps a tall, readable grid on the normally scrolling page;
				    from xl the grid fills the card body exactly. */}
				<div className="h-[62vh] min-h-[420px] xl:h-full xl:min-h-0">{children}</div>
			</div>
		</section>
	);
}

interface CalendarSidePaneProps {
	children: ReactNode;
	className?: string;
}

/**
 * The only scrolling region on a wide screen. Below `xl` the pane is part of
 * the normal page flow, so it must not become a nested scroll container there.
 */
export function CalendarSidePane({ children, className }: CalendarSidePaneProps) {
	return (
		<aside
			className={cn(
				"flex w-full flex-col gap-4 xl:min-h-0 xl:w-[300px] xl:flex-none xl:overflow-x-hidden xl:overflow-y-auto xl:pr-1 xl:pb-1",
				className,
			)}
		>
			{children}
		</aside>
	);
}

interface CalendarSidePanelProps {
	/** Accessible name for the panel, e.g. "Upcoming events". */
	label?: string;
	children: ReactNode;
	className?: string;
}

/** A card inside `CalendarSidePane`. Height is content-driven so the pane scrolls. */
export function CalendarSidePanel({ label, children, className }: CalendarSidePanelProps) {
	return (
		<section
			aria-label={label}
			className={cn(
				"min-w-0 rounded-[28px] border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900",
				className,
			)}
		>
			{children}
		</section>
	);
}
