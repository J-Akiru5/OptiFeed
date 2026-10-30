import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface AdminSectionProps {
	/** Anchor id. It also names the heading (`${id}-title`), so ids stay unique. */
	id: string;
	/** Translated section heading. Rendered as an `h2` under the page `h1`. */
	title: string;
	/** Translated one-line explanation of what the section controls. */
	description?: string;
	children: ReactNode;
	className?: string;
}

/**
 * One settings section of the tenant admin console (#351).
 *
 * Several settings surfaces used to mix a page-level heading block with card
 * headings at the same level, an unlabelled card and two identically named
 * landmarks. This component gives every section the same heading size,
 * description style, spacing and responsive stacking, and ties the landmark to
 * its heading with `aria-labelledby` instead of a repeated `aria-label`.
 */
export function AdminSection({ id, title, description, children, className }: AdminSectionProps) {
	const titleId = `${id}-title`;

	return (
		<section id={id} aria-labelledby={titleId} className={cn("scroll-mt-24 space-y-4", className)}>
			<div className="min-w-0">
				<h2
					id={titleId}
					className="text-base font-black tracking-tight text-[#0A3D62] dark:text-[#8fc0ea]"
				>
					{title}
				</h2>
				{description && (
					<p className="mt-1 max-w-2xl text-xs text-[#3D5568] dark:text-gray-400">{description}</p>
				)}
			</div>
			{children}
		</section>
	);
}
