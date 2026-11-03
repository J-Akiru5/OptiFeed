import { CARD } from "@/components/superadmin/ui";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * The Command Center panel (issue #479, M3C.8; tokens #628).
 *
 * One titled surface for a block of the monitor: an optional description, a
 * muted meta line (a timestamp, a window) and an action slot in the header,
 * then the body. The surface comes from `CARD`, so every panel keeps the
 * console's light/dark pair instead of inventing a white-only card, and the
 * header divider and copy come from the console tokens rather than a one-off
 * grey.
 *
 * Presentational and synchronous: no data, no hooks, every string from a prop.
 */

const PANEL_TONES: Record<"default" | "accent", string> = {
	default: "",
	accent: "border-console-accent/40",
};

export function MonitorPanel({
	title,
	description,
	meta,
	action,
	tone = "default",
	children,
	className,
	id,
}: {
	title: string;
	description?: string;
	meta?: string;
	action?: ReactNode;
	tone?: "default" | "accent";
	children: ReactNode;
	className?: string;
	id?: string;
}) {
	const headingId = id ? `${id}-title` : undefined;

	return (
		<section
			id={id}
			aria-labelledby={headingId}
			data-monitor-panel
			className={cn(CARD, "min-w-0 overflow-hidden", PANEL_TONES[tone], className)}
		>
			<header className="flex flex-wrap items-start justify-between gap-3 border-b border-console-border px-5 py-4">
				<div className="min-w-0">
					<h2 id={headingId} className="text-sm font-black text-console-content">
						{title}
					</h2>
					{description && (
						<p className="mt-1 max-w-prose text-xs leading-snug text-console-content-muted">
							{description}
						</p>
					)}
					{meta && (
						<p className="mt-1 text-[10px] font-extrabold uppercase tracking-wider text-console-content-muted">
							{meta}
						</p>
					)}
				</div>
				{action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
			</header>
			<div className="min-w-0 p-5">{children}</div>
		</section>
	);
}

/**
 * Three-across workspace for panels on wide screens, two across from `sm`, one
 * column on phones. The command-center sections override the column count per
 * row; this is the default for a panel grid with no shape of its own.
 *
 * `min-w-0` on the grid itself matters: without it a `<pre>`-width child (a wide
 * table, a long unbroken id) would push the whole page sideways instead of
 * scrolling inside its own card.
 */
export function PanelGrid({
	children,
	className,
	"data-console-grid": dataConsoleGrid,
}: {
	children: ReactNode;
	className?: string;
	/** Names the row (`kpis`, `trend`, `queues`) so the layout tests can find it. */
	"data-console-grid"?: string;
}) {
	return (
		<div
			data-console-grid={dataConsoleGrid}
			className={cn("grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3", className)}
		>
			{children}
		</div>
	);
}
