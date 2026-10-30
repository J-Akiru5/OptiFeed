import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import {
	ArrowRight,
	CheckCircle2,
	CircleAlert,
	OctagonAlert,
	TrendingUp,
	TriangleAlert,
	Wheat,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** One item in the rail's alerts panel. Built on the server from page data. */
export interface ControlRoomAlert {
	id: string;
	tone: "danger" | "warning" | "info";
	title: string;
	detail: string;
	href?: string;
	linkLabel?: string;
}

const ALERT_ICON: Record<ControlRoomAlert["tone"], LucideIcon> = {
	danger: OctagonAlert,
	warning: TriangleAlert,
	info: CircleAlert,
};

const ALERT_TONE: Record<ControlRoomAlert["tone"], string> = {
	danger: "text-[#C42B3A] dark:text-red-400",
	warning: "text-[#B45309] dark:text-amber-400",
	info: "text-[#0A3D62] dark:text-[#8fc0ea]",
};

export function AlertsPanel({
	items,
	emptyTitle,
	emptyDescription,
	className,
}: {
	items: readonly ControlRoomAlert[];
	emptyTitle: string;
	emptyDescription: string;
	className?: string;
}) {
	if (items.length === 0) {
		return (
			<div className={cn("flex items-start gap-2.5", className)}>
				<CheckCircle2
					aria-hidden="true"
					className="mt-0.5 h-4 w-4 shrink-0 text-[#1E7B34] dark:text-green-400"
				/>
				<div className="min-w-0">
					<p className="text-xs font-black text-[#0A3D62] dark:text-gray-100">{emptyTitle}</p>
					<p className="mt-0.5 text-[11px] leading-snug text-[#3D5568] dark:text-gray-400">
						{emptyDescription}
					</p>
				</div>
			</div>
		);
	}

	return (
		<ul className={cn("space-y-2.5", className)}>
			{items.map((item) => {
				const Icon = ALERT_ICON[item.tone];
				return (
					<li key={item.id} className="flex items-start gap-2.5">
						<Icon
							aria-hidden="true"
							className={cn("mt-0.5 h-4 w-4 shrink-0", ALERT_TONE[item.tone])}
						/>
						<div className="min-w-0 flex-1">
							<p className="text-xs font-black text-[#0A3D62] dark:text-gray-100">{item.title}</p>
							<p className="mt-0.5 text-[11px] leading-snug text-[#3D5568] dark:text-gray-400">
								{item.detail}
							</p>
							{item.href && item.linkLabel && (
								<Link
									href={item.href}
									className="mt-1 inline-flex min-h-8 items-center gap-1 text-[11px] font-black text-[#C2410C] hover:underline focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-[#ff8a5c]"
								>
									{item.linkLabel} <ArrowRight aria-hidden="true" className="h-3 w-3" />
								</Link>
							)}
						</div>
					</li>
				);
			})}
		</ul>
	);
}

/**
 * The pond selector summary: the active pond's name and the two numbers a
 * farmer checks before feeding. Switching ponds stays in the header selector.
 */
export function PondSummary({
	name,
	meta,
	href,
	linkLabel,
	className,
}: {
	name: string;
	meta: readonly { label: string; value: string }[];
	href: string;
	linkLabel: string;
	className?: string;
}) {
	return (
		<div className={cn("min-w-0", className)}>
			<p className="truncate text-sm font-black text-[#0A3D62] dark:text-gray-100">{name}</p>
			<dl className="mt-2 grid grid-cols-2 gap-2">
				{meta.map((entry) => (
					<div key={entry.label}>
						<dt className="text-[10px] font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
							{entry.label}
						</dt>
						<dd className="truncate text-xs font-black text-[#0A3D62] dark:text-gray-100">
							{entry.value}
						</dd>
					</div>
				))}
			</dl>
			<Link
				href={href}
				className="mt-2 inline-flex min-h-8 items-center gap-1 text-[11px] font-black text-[#C2410C] hover:underline focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-[#ff8a5c]"
			>
				{linkLabel} <ArrowRight aria-hidden="true" className="h-3 w-3" />
			</Link>
		</div>
	);
}

/** A compact summary of the AI advisor, with a link to the full card. */
export function AdvisorSummary({
	grams,
	gramsLabel,
	unit,
	confidenceLabel,
	confidence,
	reasoning,
	emptyLabel,
	href,
	linkLabel,
	className,
}: {
	grams: number | null;
	gramsLabel: string;
	unit: string;
	confidenceLabel: string;
	confidence: string;
	reasoning: string | null;
	emptyLabel: string;
	href: string;
	linkLabel: string;
	className?: string;
}) {
	return (
		<div className={cn("min-w-0", className)}>
			{grams === null ? (
				<p className="text-[11px] font-bold text-[#3D5568] dark:text-gray-400">{emptyLabel}</p>
			) : (
				<div className="flex items-end justify-between gap-2">
					<div>
						<p className="text-[10px] font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
							{gramsLabel}
						</p>
						<p className="text-2xl font-black text-[#0A3D62] dark:text-[#5b9bd5]">
							{Math.round(grams)}
							<span className="text-sm font-bold">{unit}</span>
						</p>
					</div>
					<span className="inline-flex items-center gap-1 rounded-full bg-[#0A3D62]/5 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-[#0A3D62] dark:bg-white/5 dark:text-[#8fc0ea]">
						<TrendingUp aria-hidden="true" className="h-3 w-3" />
						{confidenceLabel}: {confidence}
					</span>
				</div>
			)}
			{grams !== null && reasoning && (
				<p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-[#3D5568] dark:text-gray-400">
					{reasoning}
				</p>
			)}
			<Link
				href={href}
				className="mt-2 inline-flex min-h-8 items-center gap-1 text-[11px] font-black text-[#C2410C] hover:underline focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-[#ff8a5c]"
			>
				{linkLabel} <ArrowRight aria-hidden="true" className="h-3 w-3" />
			</Link>
		</div>
	);
}

/** One compact stat in the rail. The FCR tile links to the growth page. */
export function StatTile({
	label,
	value,
	detail,
	icon: Icon,
	href,
	className,
}: {
	label: ReactNode;
	value: string;
	detail?: string;
	icon?: LucideIcon;
	href?: string;
	className?: string;
}) {
	const body = (
		<>
			<div className="flex items-center justify-between gap-2">
				<span className="text-[9px] font-black uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
					{label}
				</span>
				{Icon && (
					<Icon
						aria-hidden="true"
						className="h-3.5 w-3.5 shrink-0 text-[#0A3D62] dark:text-[#8fc0ea]"
					/>
				)}
			</div>
			<p className="mt-0.5 truncate text-sm font-black text-[#0A3D62] dark:text-gray-100">
				{value}
			</p>
			{detail && (
				<p className="truncate text-[9px] font-semibold text-[#3D5568] dark:text-gray-500">
					{detail}
				</p>
			)}
		</>
	);

	const classes = cn(
		"block min-w-0 rounded-xl border border-gray-100 bg-[#F7F9F8] p-2.5 transition-colors dark:border-gray-700/60 dark:bg-gray-800/60",
		href &&
			"hover:border-[#0A3D62]/20 hover:bg-white focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]",
		className,
	);

	if (href) {
		return (
			<Link href={href} className={classes}>
				{body}
			</Link>
		);
	}
	return <div className={classes}>{body}</div>;
}

/** Recent feedings, compacted for the rail. */
export function RecentFeedings({
	rows,
	emptyTitle,
	emptyHint,
	href,
	linkLabel,
}: {
	rows: readonly {
		id: string;
		time: string;
		date: string;
		sourceLabel: string;
		grams: string;
	}[];
	emptyTitle: string;
	emptyHint: string;
	href: string;
	linkLabel: string;
}) {
	if (rows.length === 0) {
		return (
			<div>
				<p className="text-xs font-black text-[#0A3D62] dark:text-gray-100">{emptyTitle}</p>
				<p className="mt-0.5 text-[11px] leading-snug text-[#3D5568] dark:text-gray-400">
					{emptyHint}
				</p>
			</div>
		);
	}

	return (
		<div>
			<ul className="space-y-1.5">
				{rows.map((row) => (
					<li
						key={row.id}
						className="flex items-center justify-between gap-2 rounded-xl bg-[#F7F9F8] px-2.5 py-1.5 dark:bg-gray-800/60"
					>
						<div className="min-w-0">
							<p className="text-xs font-black text-[#0A3D62] dark:text-gray-100">{row.time}</p>
							<p className="truncate text-[10px] font-semibold text-[#3D5568] dark:text-gray-400">
								{row.date} · {row.sourceLabel}
							</p>
						</div>
						<span className="shrink-0 text-xs font-black text-[#0A3D62] dark:text-[#5b9bd5]">
							{row.grams}
						</span>
					</li>
				))}
			</ul>
			<Link
				href={href}
				className="mt-2 inline-flex min-h-8 items-center gap-1 text-[11px] font-black text-[#C2410C] hover:underline focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-[#ff8a5c]"
			>
				{linkLabel} <ArrowRight aria-hidden="true" className="h-3 w-3" />
			</Link>
		</div>
	);
}

/** The grow-out cycle strip, kept short enough for the rail. */
export function GrowOutPanel({
	title,
	detail,
	href,
	linkLabel,
	className,
}: {
	title: ReactNode;
	detail: ReactNode;
	href: string;
	linkLabel: string;
	className?: string;
}) {
	return (
		<div className={cn("flex items-start justify-between gap-2", className)}>
			<div className="flex min-w-0 items-start gap-2">
				<span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#8fc0ea]">
					<Wheat aria-hidden="true" className="h-4 w-4" />
				</span>
				<div className="min-w-0">
					<p className="truncate text-xs font-black text-[#0A3D62] dark:text-[#5b9bd5]">{title}</p>
					<p className="text-[10px] font-semibold leading-snug text-[#3D5568] dark:text-gray-400">
						{detail}
					</p>
				</div>
			</div>
			<Link
				href={href}
				className="inline-flex min-h-8 shrink-0 items-center gap-1 text-[11px] font-black text-[#C2410C] hover:underline focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-[#ff8a5c]"
			>
				{linkLabel} <ArrowRight aria-hidden="true" className="h-3 w-3" />
			</Link>
		</div>
	);
}
