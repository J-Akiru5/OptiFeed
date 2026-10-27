import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface AdminEmptyStateProps {
	icon: LucideIcon;
	/** Translated headline, e.g. the list has nothing in it yet. */
	title: string;
	/** Translated explanation of what to do next. */
	description?: string;
	/** Optional call to action, usually a Link styled as a button. */
	action?: ReactNode;
	className?: string;
}

/**
 * Consistent empty state for the admin console lists.
 *
 * The icon is decorative; the title carries the message, so screen readers get
 * one clear announcement instead of an unlabelled graphic.
 */
export function AdminEmptyState({
	icon: Icon,
	title,
	description,
	action,
	className,
}: AdminEmptyStateProps) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center dark:border-gray-700 dark:bg-gray-900",
				className,
			)}
		>
			<Icon aria-hidden="true" className="h-10 w-10 text-gray-300 dark:text-gray-600" />
			<p className="mt-3 text-sm font-black text-[#0A3D62] dark:text-gray-100">{title}</p>
			{description && (
				<p className="mt-1 max-w-sm text-xs text-[#3D5568] dark:text-gray-400">{description}</p>
			)}
			{action && <div className="mt-4">{action}</div>}
		</div>
	);
}
