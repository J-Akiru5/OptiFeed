import { cn } from "@/lib/utils";
import { type LucideIcon, X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shared presentation for the platform console (T-09c).
 *
 * These are the console's own primitives, built only from the design tokens and
 * Tailwind classes the console already used (navy #0A3D62, action #E85A2A,
 * page background #F4F7F6). They exist so the pages built by different tasks
 * (device registry, step-up, view-as, remote feeder control, org members) share
 * one card, table, badge, form and empty-state look instead of drifting.
 *
 * Nothing here fetches data, checks permissions or renders a link, so the file
 * stays usable from both server and client components.
 */

/** Visible keyboard focus for every console control (WCAG 2.4.7). */
export const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0B1220]";

/** Same ring, for the navy header, sidebar and bottom nav. */
export const FOCUS_RING_ON_DARK =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A3D62] dark:focus-visible:ring-offset-[#08111D]";

/**
 * Console surfaces (#477). Every card, field and table header paints from these
 * three pairs so a page never mixes a light card into a dark console.
 *
 * Dark palette: page #0B1220, surface #111A2C, raised #162238, border #24304A.
 * Status colours stay reserved for status (T25); the accent is brand orange.
 */
export const CARD =
	"rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-[#24304A] dark:bg-[#111A2C] dark:shadow-black/30";

export const FIELD_LABEL =
	"block text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400 dark:text-slate-300";

export const FIELD_INPUT =
	"w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2 text-sm text-[#0A3D62] transition-all placeholder:text-[#3D5568]/70 focus:outline-none focus:ring-2 focus:ring-[#E85A2A] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#24304A] dark:bg-[#0B1220] dark:text-slate-100 dark:placeholder:text-slate-500";

export const FIELD_HINT = "text-[11px] leading-snug text-[#3D5568] dark:text-slate-400";

export const PRIMARY_BUTTON = cn(
	// #C2410C is the AA-safe console action orange (5.2:1 against white); the
	// brighter #E85A2A stays the brand accent for decoration and badges only.
	"inline-flex items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#9A3412] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#FF8A5C] dark:text-[#0B1220] dark:hover:bg-[#ff9d75]",
	FOCUS_RING,
);

export const SECONDARY_BUTTON = cn(
	"inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#0A3D62]/20 bg-white px-3 py-2 text-xs font-black text-[#0A3D62] transition-colors hover:bg-[#F4F7F6] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#24304A] dark:bg-[#162238] dark:text-slate-100 dark:hover:bg-[#1B2740]",
	FOCUS_RING,
);

export const DANGER_BUTTON = cn(
	"inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#C42B3A] px-3 py-2 text-xs font-black text-white transition-colors hover:bg-[#a92333] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#F87171] dark:text-[#0B1220] dark:hover:bg-[#fca5a5]",
	FOCUS_RING,
);

export type BadgeTone = "brand" | "accent" | "neutral" | "success" | "danger" | "warning";

const BADGE_TONES: Record<BadgeTone, string> = {
	brand: "bg-[#0A3D62] text-white dark:bg-[#1B3A57] dark:text-slate-100",
	accent: "bg-[#C2410C] text-white dark:bg-[#FF8A5C] dark:text-[#0B1220]",
	neutral:
		"border border-gray-200 bg-[#F4F7F6] text-[#3D5568] dark:border-[#24304A] dark:bg-[#162238] dark:text-slate-300",
	success: "bg-[#E8F5EC] text-[#1E7B34] dark:bg-emerald-950/50 dark:text-emerald-300",
	danger: "bg-[#FDE8EA] text-[#C42B3A] dark:bg-red-950/50 dark:text-red-300",
	warning: "bg-[#FFF3E8] text-[#B45309] dark:bg-amber-950/50 dark:text-amber-300",
};

/** One status/role pill. The icon is decorative; the text carries the meaning. */
export function Badge({
	tone = "neutral",
	icon: Icon,
	children,
	className,
}: {
	tone?: BadgeTone;
	icon?: LucideIcon;
	children: ReactNode;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
				BADGE_TONES[tone],
				className,
			)}
		>
			{Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
			{children}
		</span>
	);
}

/** Page title block: one h1 per page, an optional lede, and optional actions. */
export function PageHeader({
	title,
	description,
	actions,
	className,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}
		>
			<div className="min-w-0">
				{/* The mobile band shows the title; the h1 stays for assistive tech. */}
				<h1 className="sr-only text-2xl font-black text-[#0A3D62] lg:not-sr-only dark:text-slate-100">
					{title}
				</h1>
				{description && (
					<p className="mt-1 max-w-2xl text-sm text-[#3D5568] dark:text-slate-400">{description}</p>
				)}
			</div>
			{actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
		</div>
	);
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn(CARD, className)}>{children}</div>;
}

export interface ConsoleContrastPair {
	/** What the pair paints, e.g. "console page text". */
	label: string;
	light: { background: string; foreground: string };
	dark: { background: string; foreground: string };
}

/**
 * The rendered pairs the console palette depends on (#477). Values mirror the
 * classes above; `superadmin-theme.test.tsx` asserts every pair is at least
 * 4.5:1 (WCAG AA normal text) in both themes, the same contract the console
 * dialog already carries.
 */
export const CONSOLE_CONTRAST: readonly ConsoleContrastPair[] = [
	{
		label: "page text",
		light: { background: "#F4F7F6", foreground: "#0A3D62" },
		dark: { background: "#0B1220", foreground: "#E2E8F0" },
	},
	{
		label: "card text",
		light: { background: "#FFFFFF", foreground: "#0A3D62" },
		dark: { background: "#111A2C", foreground: "#E2E8F0" },
	},
	{
		label: "muted text",
		light: { background: "#FFFFFF", foreground: "#3D5568" },
		dark: { background: "#111A2C", foreground: "#94A3B8" },
	},
	{
		label: "primary action label",
		light: { background: "#C2410C", foreground: "#FFFFFF" },
		dark: { background: "#FF8A5C", foreground: "#0B1220" },
	},
	{
		label: "status success",
		light: { background: "#E8F5EC", foreground: "#1E7B34" },
		dark: { background: "#111A2C", foreground: "#4ADE80" },
	},
	{
		label: "status warning",
		light: { background: "#FFF3E8", foreground: "#B45309" },
		dark: { background: "#111A2C", foreground: "#FBBF24" },
	},
	{
		label: "status danger",
		light: { background: "#FDE8EA", foreground: "#C42B3A" },
		dark: { background: "#111A2C", foreground: "#F87171" },
	},
] as const;

export function SectionTitle({
	title,
	description,
	actions,
	className,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-[#24304A]",
				className,
			)}
		>
			<div className="min-w-0">
				<h2 className="font-black text-[#0A3D62] dark:text-slate-100">{title}</h2>
				{description && (
					<p className="mt-1 text-xs text-[#3D5568] dark:text-slate-400">{description}</p>
				)}
			</div>
			{actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
		</div>
	);
}

export function StatCard({
	label,
	value,
	hint,
	icon: Icon,
}: {
	label: string;
	value: number;
	hint?: string;
	icon?: LucideIcon;
}) {
	return (
		<div className={cn(CARD, "flex flex-col gap-1 p-5")}>
			<div className="flex items-center justify-between gap-2">
				<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
					{label}
				</span>
				{Icon && (
					<Icon
						className="h-4 w-4 shrink-0 text-[#0A3D62]/70 dark:text-slate-400"
						aria-hidden="true"
					/>
				)}
			</div>
			<span className="text-2xl font-black tabular-nums text-[#0A3D62] sm:text-3xl dark:text-slate-100">
				{value}
			</span>
			{hint && <span className="text-[11px] text-[#3D5568] dark:text-slate-400">{hint}</span>}
		</div>
	);
}

/**
 * Table card for the md+ layouts. Wide tables scroll inside this container, so
 * the page itself never scrolls sideways. `caption` gives the table an
 * accessible name; every header cell is a `<th scope="col">`.
 */
export function TableFrame({
	label,
	columns,
	children,
	minWidth = "min-w-[44rem]",
	className,
}: {
	label: string;
	columns: { key: string; label: string; className?: string }[];
	children: ReactNode;
	minWidth?: string;
	className?: string;
}) {
	return (
		<div className={cn(CARD, "data-list-table overflow-hidden", className)}>
			<div className="overflow-x-auto">
				<table className={cn("w-full text-sm", minWidth)}>
					<caption className="sr-only">{label}</caption>
					<thead>
						<tr className="border-b border-gray-100 bg-[#F4F7F6] dark:border-[#24304A] dark:bg-[#0B1220]">
							{columns.map((column) => (
								<th
									key={column.key}
									scope="col"
									className={cn(
										"px-6 py-3 text-left text-[10px] font-black uppercase tracking-wider text-[#3D5568] dark:text-slate-400",
										column.className,
									)}
								>
									{column.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>{children}</tbody>
				</table>
			</div>
		</div>
	);
}

/** One `<li>` in the mobile card list that replaces a wide table below `md`. */
export function MobileCard({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <li className={cn(CARD, "min-w-0 space-y-3 p-4", className)}>{children}</li>;
}

/** Label/value pair for a mobile card's `<dl>`. */
export function MetaPair({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
				{label}
			</dt>
			<dd className="mt-0.5 truncate text-xs font-bold text-[#0A3D62] dark:text-slate-100">
				{children}
			</dd>
		</div>
	);
}

export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
}: {
	icon?: LucideIcon;
	title: string;
	description?: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
			{Icon && <Icon className="h-10 w-10 text-gray-300 dark:text-slate-600" aria-hidden="true" />}
			<p className="font-bold text-[#0A3D62] dark:text-slate-100">{title}</p>
			{description && (
				<p className="max-w-md text-sm text-[#3D5568] dark:text-slate-400">{description}</p>
			)}
			{action && <div className="mt-2">{action}</div>}
		</div>
	);
}

export function Alert({
	tone,
	children,
	onDismiss,
	dismissLabel,
}: {
	tone: "error" | "success" | "warning";
	children: ReactNode;
	onDismiss?: () => void;
	dismissLabel?: string;
}) {
	const tones = {
		error:
			"border-[#C42B3A]/30 bg-[#FDE8EA] text-[#C42B3A] dark:border-red-500/40 dark:bg-red-950/50 dark:text-red-300",
		success:
			"border-[#1E7B34]/30 bg-[#E8F5EC] text-[#1E7B34] dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-300",
		warning:
			"border-[#E85A2A]/30 bg-[#FFF3E8] text-[#B45309] dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-300",
	} as const;

	return (
		<div
			role={tone === "error" ? "alert" : "status"}
			className={cn(
				"flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-bold",
				tones[tone],
			)}
		>
			<div className="min-w-0">{children}</div>
			{onDismiss && (
				<button
					type="button"
					onClick={onDismiss}
					aria-label={dismissLabel}
					className={cn("shrink-0 rounded p-0.5 transition-colors hover:bg-white/60", FOCUS_RING)}
				>
					<X className="h-3.5 w-3.5" aria-hidden="true" />
				</button>
			)}
		</div>
	);
}
