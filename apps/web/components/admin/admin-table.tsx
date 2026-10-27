import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface AdminTableProps {
	children: ReactNode;
	/** Screen-reader summary of the table. The visible page heading is outside it. */
	caption?: string;
	/**
	 * Minimum table width. Wide tables scroll inside their own container rather
	 * than pushing the page sideways; below `md` the rows render as cards.
	 */
	minWidth?: string;
	className?: string;
}

/**
 * Responsive table shell for the admin console.
 *
 * Hidden below `md` so pages can render a card list for narrow screens, and the
 * scroll container is the table wrapper only — the page itself never scrolls
 * horizontally.
 */
export function AdminTable({
	children,
	caption,
	minWidth = "min-w-[44rem]",
	className,
}: AdminTableProps) {
	return (
		<div
			className={cn(
				"hidden overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm md:block dark:border-gray-700/60 dark:bg-gray-900",
				className,
			)}
		>
			<div className="overflow-x-auto">
				<table className={cn("w-full text-sm", minWidth)}>
					{caption && <caption className="sr-only">{caption}</caption>}
					{children}
				</table>
			</div>
		</div>
	);
}

export function AdminTHead({ children }: { children: ReactNode }) {
	return (
		<thead>
			<tr className="border-b border-gray-100 bg-[#F4F7F6] dark:border-gray-700/60 dark:bg-gray-800/60">
				{children}
			</tr>
		</thead>
	);
}

export function AdminTh({
	children,
	className,
	align = "left",
}: {
	children: ReactNode;
	className?: string;
	align?: "left" | "right";
}) {
	return (
		<th
			scope="col"
			className={cn(
				"px-4 py-3 text-[10px] font-black uppercase tracking-wider text-[#3D5568] dark:text-gray-400",
				align === "right" ? "text-right" : "text-left",
				className,
			)}
		>
			{children}
		</th>
	);
}

export function AdminTr({ children }: { children: ReactNode }) {
	return (
		<tr className="border-b border-gray-50 last:border-0 hover:bg-[#F4F7F6]/60 dark:border-gray-800 dark:hover:bg-gray-800/40">
			{children}
		</tr>
	);
}

export function AdminTd({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <td className={cn("px-4 py-4 align-middle", className)}>{children}</td>;
}

/** Card list shown instead of the table below `md`. */
export function AdminCardList({ children }: { children: ReactNode }) {
	return <ul className="space-y-3 md:hidden">{children}</ul>;
}

export function AdminCard({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<li
			className={cn(
				"rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900",
				className,
			)}
		>
			{children}
		</li>
	);
}

/** Label/value pair inside a mobile card. */
export function AdminCardRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-baseline justify-between gap-3 py-1">
			<span className="text-[10px] font-black uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
				{label}
			</span>
			<span className="min-w-0 text-right text-xs font-bold text-[#0A3D62] dark:text-gray-100">
				{children}
			</span>
		</div>
	);
}
