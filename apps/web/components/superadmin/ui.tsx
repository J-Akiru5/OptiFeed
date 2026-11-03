import { cn } from "@/lib/utils";
import { type LucideIcon, X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shared presentation for the platform console (T-09c, #628).
 *
 * These are the console's own primitives. Since #628 they name colours only
 * through the `console-*` tokens declared once in `app/globals.css`
 * (`bg-console-surface`, `border-console-border`, `text-console-ok-content`,
 * ...). No class in this file carries a hex literal or a raw Tailwind colour,
 * because every one of them has a light and a dark value behind the same name:
 * a surface that is paper in light mode is the slate panel in dark mode through
 * the same class, so a component cannot be half-themed by accident.
 *
 * Nothing here fetches data, checks permissions or renders a link, so the file
 * stays usable from both server and client components.
 */

/** Visible keyboard focus for every console control (WCAG 2.4.7). */
export const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-focus focus-visible:ring-offset-2 focus-visible:ring-offset-console-surface";

/** Same ring, for the navy header, sidebar and bottom nav. */
export const FOCUS_RING_ON_DARK =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-header-ink focus-visible:ring-offset-2 focus-visible:ring-offset-console-header";

/**
 * Console surfaces (#477, #628). Every card, field and table header paints from
 * these pairs so a page never mixes a light card into a dark console.
 *
 * The palette is slate-navy in dark mode and the brand-neutral paper in light
 * mode (both live in `app/globals.css`). Status colours stay reserved for
 * status (T25); the accent is the AA-safe action orange.
 */
export const CARD = "rounded-2xl border border-console-border bg-console-surface shadow-sm";

export const FIELD_LABEL =
	"block text-[10px] font-extrabold uppercase tracking-wider text-console-content-muted";

export const FIELD_INPUT =
	"w-full rounded-xl border border-console-control-border bg-console-surface-sunken px-3 py-2 text-sm text-console-content transition-all placeholder:text-console-content-muted focus:outline-none focus:ring-2 focus:ring-console-focus disabled:cursor-not-allowed disabled:opacity-60";

export const FIELD_HINT = "text-[11px] leading-snug text-console-content-muted";

export const PRIMARY_BUTTON = cn(
	// `--console-accent` is the AA-safe action orange (5.2:1 against white in
	// light, 8.1:1 against the dark page); the brighter brand orange stays the
	// decorative accent and the focus ring.
	"inline-flex items-center justify-center gap-2 rounded-xl bg-console-accent px-4 py-2.5 text-sm font-bold text-console-accent-foreground shadow-sm transition-colors hover:bg-console-accent-strong disabled:cursor-not-allowed disabled:opacity-60",
	FOCUS_RING,
);

export const SECONDARY_BUTTON = cn(
	"inline-flex items-center justify-center gap-1.5 rounded-xl border border-console-control-border bg-console-surface-raised px-3 py-2 text-xs font-black text-console-content transition-colors hover:bg-console-surface-sunken disabled:cursor-not-allowed disabled:opacity-60",
	FOCUS_RING,
);

export const DANGER_BUTTON = cn(
	"inline-flex items-center justify-center gap-1.5 rounded-xl bg-console-critical-strong px-3 py-2 text-xs font-black text-console-accent-foreground transition-colors hover:bg-console-critical-hover disabled:cursor-not-allowed disabled:opacity-60",
	FOCUS_RING,
);

export type BadgeTone = "brand" | "accent" | "neutral" | "success" | "danger" | "warning";

const BADGE_TONES: Record<BadgeTone, string> = {
	brand: "bg-console-header text-console-header-ink",
	accent: "bg-console-accent text-console-accent-foreground",
	neutral: "border border-console-border bg-console-surface-sunken text-console-content-muted",
	success: "bg-console-ok-surface text-console-ok-content",
	danger: "bg-console-critical-surface text-console-critical-content",
	warning: "bg-console-warn-surface text-console-warn-content",
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
				<h1 className="sr-only text-2xl font-black text-console-content lg:not-sr-only">{title}</h1>
				{description && (
					<p className="mt-1 max-w-2xl text-sm text-console-content-muted">{description}</p>
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
	/**
	 * CSS custom property name without its leading `--`. The value is read from
	 * `app/globals.css` by `superadmin-theme.test.tsx`, so the palette lives in
	 * exactly one place instead of being restated here.
	 */
	background: string;
	foreground: string;
}

/**
 * Every text pair the console renders (#477, #628). `superadmin-theme.test.tsx`
 * reads the matching `--<name>` values out of the light `:root` block and the
 * `.dark` block in `app/globals.css` and asserts each one is at least 4.5:1
 * (WCAG AA normal text) in both themes.
 */
export const CONSOLE_CONTRAST: readonly ConsoleContrastPair[] = [
	{ label: "page text", background: "console-page", foreground: "console-content" },
	{ label: "page muted text", background: "console-page", foreground: "console-content-muted" },
	{ label: "card text", background: "console-surface", foreground: "console-content" },
	{ label: "card muted text", background: "console-surface", foreground: "console-content-muted" },
	{
		label: "raised surface text",
		background: "console-surface-raised",
		foreground: "console-content",
	},
	{
		label: "raised surface muted text",
		background: "console-surface-raised",
		foreground: "console-content-muted",
	},
	// Table headers and form fields sit on the sunken surface.
	{
		label: "sunken surface text",
		background: "console-surface-sunken",
		foreground: "console-content",
	},
	{
		label: "sunken surface muted text",
		background: "console-surface-sunken",
		foreground: "console-content-muted",
	},
	{
		label: "primary action label",
		background: "console-accent",
		foreground: "console-accent-foreground",
	},
	{
		label: "primary action label on hover",
		background: "console-accent-strong",
		foreground: "console-accent-foreground",
	},
	{
		label: "destructive action label",
		background: "console-critical-strong",
		foreground: "console-accent-foreground",
	},
	{
		label: "destructive action label on hover",
		background: "console-critical-hover",
		foreground: "console-accent-foreground",
	},
	{ label: "status success", background: "console-ok-surface", foreground: "console-ok-content" },
	{
		label: "status warning",
		background: "console-warn-surface",
		foreground: "console-warn-content",
	},
	{
		label: "status critical",
		background: "console-critical-surface",
		foreground: "console-critical-content",
	},
	// Status text also appears directly on a card, without its tinted pill.
	{
		label: "status success on a card",
		background: "console-surface",
		foreground: "console-ok-content",
	},
	{
		label: "status warning on a card",
		background: "console-surface",
		foreground: "console-warn-content",
	},
	{
		label: "status critical on a card",
		background: "console-surface",
		foreground: "console-critical-content",
	},
	// The header band and the sidebar share `--console-header`.
	{ label: "header band label", background: "console-header", foreground: "console-header-ink" },
	{
		label: "header band muted label",
		background: "console-header",
		foreground: "console-header-ink-muted",
	},
	{
		label: "active nav label",
		background: "console-accent",
		foreground: "console-accent-foreground",
	},
] as const;

export interface ConsoleContrastRule extends ConsoleContrastPair {
	/** 3 for non-text UI (WCAG 1.4.11), 4.5 for normal text. */
	minimum: number;
}

/**
 * The non-text pairs: a control's outline and the focus ring are "visual
 * information required to identify a user interface component", so they are held
 * to 3:1 (WCAG 1.4.11) rather than 4.5:1. The brand orange fails as text on
 * white but passes comfortably as a 3:1 ring, which is exactly why it is only
 * used for the ring.
 */
export const CONSOLE_NON_TEXT_CONTRAST: readonly ConsoleContrastRule[] = [
	{
		label: "focus ring on a card",
		background: "console-surface",
		foreground: "console-focus",
		minimum: 3,
	},
	{
		label: "focus ring on the page",
		background: "console-page",
		foreground: "console-focus",
		minimum: 3,
	},
	{
		label: "focus ring in the header band",
		background: "console-header",
		foreground: "console-header-ink",
		minimum: 3,
	},
	{
		label: "field outline",
		background: "console-surface-sunken",
		foreground: "console-control-border",
		minimum: 3,
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
				"flex flex-wrap items-start justify-between gap-3 border-b border-console-border px-5 py-4",
				className,
			)}
		>
			<div className="min-w-0">
				<h2 className="font-black text-console-content">{title}</h2>
				{description && <p className="mt-1 text-xs text-console-content-muted">{description}</p>}
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
				<span className="text-[10px] font-extrabold uppercase tracking-wider text-console-content-muted">
					{label}
				</span>
				{Icon && (
					<Icon className="h-4 w-4 shrink-0 text-console-content-muted" aria-hidden="true" />
				)}
			</div>
			<span className="text-2xl font-black tabular-nums text-console-content sm:text-3xl">
				{value}
			</span>
			{hint && <span className="text-[11px] text-console-content-muted">{hint}</span>}
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
						<tr className="border-b border-console-border bg-console-surface-sunken">
							{columns.map((column) => (
								<th
									key={column.key}
									scope="col"
									className={cn(
										"px-6 py-3 text-left text-[10px] font-black uppercase tracking-wider text-console-content-muted",
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
			<dt className="text-[9px] font-black uppercase tracking-wider text-console-content-muted">
				{label}
			</dt>
			<dd className="mt-0.5 truncate text-xs font-bold text-console-content">{children}</dd>
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
			{Icon && <Icon className="h-10 w-10 text-console-border-strong" aria-hidden="true" />}
			<p className="font-bold text-console-content">{title}</p>
			{description && <p className="max-w-md text-sm text-console-content-muted">{description}</p>}
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
			"border-console-critical-content/30 bg-console-critical-surface text-console-critical-content",
		success: "border-console-ok-content/30 bg-console-ok-surface text-console-ok-content",
		warning: "border-console-warn-content/30 bg-console-warn-surface text-console-warn-content",
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
					className={cn(
						"shrink-0 rounded p-0.5 transition-colors hover:bg-console-surface/60",
						FOCUS_RING,
					)}
				>
					<X className="h-3.5 w-3.5" aria-hidden="true" />
				</button>
			)}
		</div>
	);
}
