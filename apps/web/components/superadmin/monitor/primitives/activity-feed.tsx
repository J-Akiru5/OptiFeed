import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * The "what just happened" list (issue #479, M3C.8; tokens #628).
 *
 * A semantic ordered list: the page supplies newest-first items, and each row
 * carries a title, an optional context line and a `<time>` string already
 * formatted in the reader's locale. The tone dot or icon is decoration; the
 * words carry the meaning, so nothing is lost without colour. Row dividers are
 * the console border token, so the list separates the same way in both themes.
 */

type FeedTone = "ok" | "warning" | "danger" | "neutral";

const DOT_TONES: Record<FeedTone, string> = {
	ok: "bg-console-ok-content",
	warning: "bg-console-warn-content",
	danger: "bg-console-critical-content",
	neutral: "bg-console-content-muted",
};

const ICON_TONES: Record<FeedTone, string> = {
	ok: "text-console-ok-content",
	warning: "text-console-warn-content",
	danger: "text-console-critical-content",
	neutral: "text-console-content-muted",
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
					"rounded-xl border border-dashed border-console-border px-4 py-6 text-center text-xs font-bold text-console-content-muted",
					className,
				)}
			>
				{empty}
			</p>
		);
	}

	return (
		<ol className={cn("min-w-0 divide-y divide-console-border", className)}>
			{items.map((item) => {
				const Icon = item.icon;
				const tone = item.tone ?? "neutral";
				return (
					<li key={item.id} className="flex min-w-0 items-start gap-3 py-3 first:pt-0 last:pb-0">
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
							<p className="text-xs font-bold text-console-content">{item.title}</p>
							{item.meta && (
								<p className="mt-0.5 text-[11px] leading-snug text-console-content-muted">
									{item.meta}
								</p>
							)}
						</div>
						<time className="shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-console-content-muted">
							{item.time}
						</time>
					</li>
				);
			})}
		</ol>
	);
}
