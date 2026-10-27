import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface AdminPageHeaderProps {
	/** Translated page title. Rendered as the only `h1` on the page. */
	title: string;
	/** Translated one-line description shown under the title. */
	description?: string;
	/** Optional leading icon. Decorative: the title already names the page. */
	icon?: LucideIcon;
	/** Page-level actions. Stacks under the title on narrow screens. */
	actions?: ReactNode;
	/** Extra content under the description, e.g. a helper note. */
	children?: ReactNode;
	className?: string;
}

/**
 * Shared heading block for every tenant admin page.
 *
 * Keeps the h1 size, spacing, icon treatment and responsive stacking identical
 * across the console instead of repeating them on each page.
 */
export function AdminPageHeader({
	title,
	description,
	icon: Icon,
	actions,
	children,
	className,
}: AdminPageHeaderProps) {
	return (
		<header
			className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}
		>
			<div className="flex min-w-0 items-start gap-3">
				{Icon && (
					<span
						aria-hidden="true"
						className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]"
					>
						<Icon className="h-6 w-6" />
					</span>
				)}
				<div className="min-w-0">
					<h1 className="text-2xl font-black tracking-tight text-[#0A3D62] dark:text-[#5b9bd5]">
						{title}
					</h1>
					{description && (
						<p className="mt-1 max-w-2xl text-sm text-[#3D5568] dark:text-gray-300">
							{description}
						</p>
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
