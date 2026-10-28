import { Mascot, type MascotPose } from "@/components/assistant/mascot";
import { dashboardFocus, dashboardSurface } from "@/components/dashboard/dashboard-classes";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

interface DashboardPageShellProps {
	children: ReactNode;
	/** Page spacing/animation utilities, appended to the shared width. */
	className?: string;
}

/**
 * Shared content width for every farmer page (#247).
 *
 * Pages used to cap themselves at an ad-hoc `max-w-4xl`/`max-w-5xl` without
 * centring, so a wide monitor showed a narrow column pinned to the left with a
 * large unused gap. The widest farmer page (Growth) already used `max-w-7xl`;
 * this component makes that the one page width, and the pages that gained room
 * spend it on a two-column layout instead of stretching a single form.
 */
export function DashboardPageShell({ children, className }: DashboardPageShellProps) {
	return <div className={cn("mx-auto w-full max-w-7xl", className)}>{children}</div>;
}

interface DashboardPageHeaderProps {
	/** Translated page title. Rendered as the only `h1` on the page. */
	title: string;
	/** Translated description shown under the title. */
	description?: ReactNode;
	/** Optional leading icon. Decorative: the title already names the page. */
	icon?: LucideIcon;
	/** Page-level actions. Stacks under the title on narrow screens. */
	actions?: ReactNode;
	/** Extra content under the description, e.g. a helper note. */
	children?: ReactNode;
	/**
	 * A Pakoy pose beside the greeting (dashboard home, #221). A header that
	 * greets with the mascot shows its title on phones too, so the friendly
	 * line is never hidden from the person it is greeting.
	 */
	mascot?: MascotPose;
	/** One-line summary under the description, e.g. "Next feeding at 6:00 PM". */
	summary?: ReactNode;
	className?: string;
}

/**
 * Shared heading block for every farmer dashboard page.
 *
 * Keeps the h1 size, spacing, icon treatment and responsive stacking identical
 * across the dashboard instead of repeating them on each page.
 */
export function DashboardPageHeader({
	title,
	description,
	icon: Icon,
	actions,
	children,
	mascot,
	summary,
	className,
}: DashboardPageHeaderProps) {
	return (
		<header
			className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}
		>
			<div className="flex min-w-0 items-start gap-3">
				{mascot && (
					<span className="mt-0.5 shrink-0 sm:hidden">
						<Mascot pose={mascot} size={40} />
					</span>
				)}
				{mascot && (
					<span className="mt-0.5 hidden shrink-0 sm:inline-flex">
						<Mascot pose={mascot} size={52} />
					</span>
				)}
				{Icon && (
					<span
						aria-hidden="true"
						className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] lg:flex dark:bg-white/5 dark:text-[#5b9bd5]"
					>
						<Icon className="h-6 w-6" />
					</span>
				)}
				<div className="min-w-0">
					{/* The mobile header band already shows this title; the real h1
					    stays in the markup for assistive tech and from `sm` up. A
					    greeting header is the exception: it wants the warm line. */}
					<h1
						className={cn(
							"font-black tracking-tight text-[#0A3D62] dark:text-[#5b9bd5]",
							mascot
								? "text-xl sm:text-2xl lg:text-3xl"
								: "sr-only text-2xl lg:not-sr-only lg:text-3xl",
						)}
					>
						{title}
					</h1>
					{description && (
						<p className="mt-1 max-w-2xl text-sm text-[#3D5568] dark:text-gray-300">
							{description}
						</p>
					)}
					{summary && (
						<p className="mt-1 text-xs font-bold text-[#C2410C] dark:text-[#ff8a5c]">{summary}</p>
					)}
					{children}
				</div>
			</div>

			{actions && (
				<div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
			)}
		</header>
	);
}

interface DashboardEmptyStateProps {
	icon?: LucideIcon;
	/** Pakoy pose for the empty state (#221). Takes the icon's place. */
	mascot?: MascotPose;
	/** Translated headline, e.g. the list has nothing in it yet. */
	title: string;
	/** Translated explanation of what to do next. */
	description?: string;
	/** Optional call to action, usually a Link styled as a button. */
	action?: ReactNode;
	className?: string;
}

/**
 * Consistent empty state for dashboard lists and tiles.
 *
 * The icon is decorative; the title carries the message, so screen readers get
 * one clear announcement instead of an unlabelled graphic.
 */
export function DashboardEmptyState({
	icon: Icon,
	mascot,
	title,
	description,
	action,
	className,
}: DashboardEmptyStateProps) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center dark:border-gray-700 dark:bg-gray-900",
				className,
			)}
		>
			{mascot ? (
				<Mascot pose={mascot} size={80} className="mb-1" />
			) : (
				Icon && <Icon aria-hidden="true" className="h-10 w-10 text-gray-300 dark:text-gray-600" />
			)}
			<p className="mt-3 text-sm font-black text-[#0A3D62] dark:text-gray-100">{title}</p>
			{description && (
				<p className="mt-1 max-w-sm text-xs text-[#3D5568] dark:text-gray-400">{description}</p>
			)}
			{action && <div className="mt-4">{action}</div>}
		</div>
	);
}

interface DashboardSectionProps {
	/** Translated section heading (rendered as `h2`). */
	title: string;
	description?: string;
	icon?: LucideIcon;
	/** Section-level action, e.g. a "view all" link. */
	action?: ReactNode;
	children: ReactNode;
	id?: string;
	className?: string;
	/** Remove the body padding when the child manages its own (tables). */
	flush?: boolean;
}

/** Standard dashboard card with a heading block and a body. */
export function DashboardSection({
	title,
	description,
	icon: Icon,
	action,
	children,
	id,
	className,
	flush = false,
}: DashboardSectionProps) {
	return (
		<section id={id} className={cn(dashboardSurface, "overflow-hidden", className)}>
			<div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-4 dark:border-gray-700/60 sm:p-6">
				<div className="flex min-w-0 items-start gap-2.5">
					{Icon && (
						<Icon
							aria-hidden="true"
							className="mt-0.5 h-5 w-5 shrink-0 text-[#3D5568] dark:text-gray-400"
						/>
					)}
					<div className="min-w-0">
						<h2 className="text-base font-black text-[#0A3D62] dark:text-[#5b9bd5]">{title}</h2>
						{description && (
							<p className="mt-0.5 text-xs text-[#3D5568] dark:text-gray-400">{description}</p>
						)}
					</div>
				</div>
				{action}
			</div>
			<div className={flush ? "" : "p-4 sm:p-6"}>{children}</div>
		</section>
	);
}

/**
 * Read-only explanation shown wherever `canWrite()` is false.
 *
 * A VIEWER, or a superadmin using read-only view-as (plan M5.1), gets disabled
 * controls and this note instead of a control that only fails after a click.
 */
export function ReadOnlyNotice({ title, description }: { title: string; description: string }) {
	return (
		<div
			role="note"
			className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
		>
			<Lock aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
			<div className="min-w-0">
				<p className="text-sm font-black">{title}</p>
				<p className="mt-0.5 text-xs font-semibold">{description}</p>
			</div>
		</div>
	);
}

/** Link styled as a quiet inline action (used inside section headers). */
export const dashboardSectionLink = cn(
	"inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm font-black text-[#C2410C] hover:underline dark:text-[#ff8a5c]",
	dashboardFocus,
);
