import { cn } from "@/lib/utils";
import { AlertTriangle, HelpCircle, type LucideIcon, OctagonAlert } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The "what needs a decision" list (issue #479, M3C.8).
 *
 * Severity gets a distinct icon shape (octagon, triangle, question mark) as
 * well as a colour, and the row's title and meta text say what happened; the
 * page may add one action per row. Unknown is a first-class severity, because
 * a source that did not report is not the same thing as a clean one.
 */

type Severity = "critical" | "warning" | "unknown";

const SEVERITY_ICONS: Record<Severity, LucideIcon> = {
	critical: OctagonAlert,
	warning: AlertTriangle,
	unknown: HelpCircle,
};

const SEVERITY_TONES: Record<Severity, string> = {
	critical: "text-[#C42B3A] dark:text-[#F87171]",
	warning: "text-[#B45309] dark:text-[#FBBF24]",
	unknown: "text-[#3D5568] dark:text-[#94A3B8]",
};

export function AttentionList({
	items,
	empty,
	className,
}: {
	items: {
		id: string;
		title: string;
		meta?: string;
		severity: Severity;
		action?: ReactNode;
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
		<ul className={cn("divide-y divide-gray-100 dark:divide-[#24304A]", className)}>
			{items.map((item) => {
				const Icon = SEVERITY_ICONS[item.severity];
				return (
					<li
						key={item.id}
						data-severity={item.severity}
						className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
					>
						<Icon
							className={cn("mt-0.5 h-4 w-4 shrink-0", SEVERITY_TONES[item.severity])}
							aria-hidden="true"
						/>
						<div className="min-w-0 flex-1">
							<p className="text-xs font-bold text-[#0A3D62] dark:text-slate-100">{item.title}</p>
							{item.meta && (
								<p className="mt-0.5 text-[11px] leading-snug text-[#3D5568] dark:text-slate-400">
									{item.meta}
								</p>
							)}
						</div>
						{item.action && <div className="shrink-0">{item.action}</div>}
					</li>
				);
			})}
		</ul>
	);
}
