import { CARD } from "@/components/superadmin/ui";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * The Command Center panel (issue #479, M3C.8).
 *
 * One titled surface for a block of the monitor: an optional description, a
 * muted meta line (a timestamp, a window) and an action slot in the header,
 * then the body. The surface comes from `CARD`, so every panel keeps the
 * console's light/dark pair instead of inventing a white-only card.
 *
 * Presentational and synchronous: no data, no hooks, every string from a prop.
 */

const PANEL_TONES: Record<"default" | "accent", string> = {
	default: "",
	accent: "border-[#C2410C]/35 dark:border-[#FF8A5C]/45",
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
			className={cn(CARD, "overflow-hidden", PANEL_TONES[tone], className)}
		>
			<header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-[#24304A]">
				<div className="min-w-0">
					<h2 id={headingId} className="text-sm font-black text-[#0A3D62] dark:text-slate-100">
						{title}
					</h2>
					{description && (
						<p className="mt-1 max-w-prose text-xs leading-snug text-[#3D5568] dark:text-slate-400">
							{description}
						</p>
					)}
					{meta && (
						<p className="mt-1 text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
							{meta}
						</p>
					)}
				</div>
				{action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
			</header>
			<div className="p-5">{children}</div>
		</section>
	);
}

/** Three-across workspace for panels on wide screens, one column on phones. */
export function PanelGrid({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3", className)}>
			{children}
		</div>
	);
}
