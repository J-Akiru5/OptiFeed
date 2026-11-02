import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * The "what just happened" list (issue #479, M3C.8).
 *
 * A semantic ordered list: the page supplies newest-first items, and each row
 * carries a title, an optional context line and a `<time>` string already
 * formatted in the reader's locale. The tone dot or icon is decoration; the
 * words carry the meaning, so nothing is lost without colour.
 */

type FeedTone = "ok" | "warning" | "danger" | "neutral";

const DOT_TONES: Record<FeedTone, string> = {
	ok: "bg-[#1E7B34] dark:bg-[#4ADE80]",
	warning: "bg-[#B45309] dark:bg-[#FBBF24]",
	danger: "bg-[#C42B3A] dark:bg-[#F87171]",
	neutral: "bg-[#3D5568] dark:bg-[#94A3B8]",
};

const ICON_TONES: Record<FeedTone, string> = {
	ok: "text-[#1E7B34] dark:text-[#4ADE80]",
	warning: "text-[#B45309] dark:text-[#FBBF24]",
	danger: "text-[#C42B3A] dark:text-[#F87171]",
	neutral: "text-[#3D5568] dark:text-[#94A3B8]",
};

export function ActivityFeed({
	items,
	empty,
	className,
}: {
	items: {
		id: string;
		title: string;
		meta?: string;
		time: string;
		tone?: FeedTone;
		icon?: LucideIcon;
	}[];
	empty: string;
	className?: string;
}) {
	if (items.length === 0) {
		return (
			<p
				className={cn(
					"rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-xs font-bold text-[#3D5568] dark:border-[#24304A] dark:text-slate-400",
					className,
				)}
			>
				{empty}
			</p>
		);
	}

	return (
		<ol className={cn("divide-y divide-gray-100 dark:divide-[#24304A]", className)}>
			{items.map((item) => {
				const Icon = item.icon;
				const tone = item.tone ?? "neutral";
				return (
					<li key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
						{Icon ? (
							<span className={cn("mt-0.5 shrink-0", ICON_TONES[tone])}>
								<Icon className="h-4 w-4" aria-hidden="true" />
							</span>
						) : (
							<span
								aria-hidden="true"
								className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT_TONES[tone])}
							/>
						)}
						<div className="min-w-0 flex-1">
							<p className="text-xs font-bold text-[#0A3D62] dark:text-slate-100">{item.title}</p>
							{item.meta && (
								<p className="mt-0.5 text-[11px] leading-snug text-[#3D5568] dark:text-slate-400">
									{item.meta}
								</p>
							)}
						</div>
						<time className="shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
							{item.time}
						</time>
					</li>
				);
			})}
		</ol>
	);
}
