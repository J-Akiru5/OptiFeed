import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Card grid used by the Card view of every item list (decision E2).
 *
 * One column on phones, two on tablets and three on wide screens, so the card
 * view carries the same fields and row actions as the table without stretching
 * a single card across a desktop page. Cards themselves stay per-list (admin,
 * dashboard and superadmin each own their palette); only the grid is shared.
 */
export function ItemCardGrid({
	children,
	label,
	className,
}: {
	children: ReactNode;
	/** Accessible name for the list, usually the table caption. */
	label?: string;
	className?: string;
}) {
	return (
		<ul
			aria-label={label}
			// `data-list-cards` and `md:hidden` keep the responsive default until
			// the reader picks Card explicitly (see `components/ui/view-toggle.tsx`).
			className={cn(
				"data-list-cards grid gap-3 sm:grid-cols-2 xl:grid-cols-3 md:hidden",
				className,
			)}
		>
			{children}
		</ul>
	);
}
