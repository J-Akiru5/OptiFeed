import { Link } from "@/i18n/routing";
import { buildPageHref, buildPageWindow } from "@/lib/pagination";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface PaginationProps {
	/** Server-page mode: the page this list lives on. */
	basePath?: string;
	/** Server-page mode: current query parameters, excluding `page`. */
	params?: Record<string, string | undefined>;
	/** Client-table mode: called with the requested page instead of navigating. */
	onPageChange?: (page: number) => void;
	/** Client-table mode: disables every control while a request is in flight. */
	disabled?: boolean;
	page: number;
	pageCount: number;
	/** Pre-formatted summary, e.g. "Showing 1–20 of 412". */
	showing?: string;
	previousLabel: string;
	nextLabel: string;
	/** Accessible name for the pagination landmark. */
	label?: string;
}

const linkClass =
	"inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]";
const activeClass = "bg-[var(--ofd-base)] text-white shadow-sm";
const idleClass = "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800";
const disabledClass = "text-gray-300 dark:text-gray-600 cursor-not-allowed select-none";

/**
 * Numbered pagination shared by every list (decision E1).
 *
 * Two modes: server pages pass `basePath` + `params` and get real links (so
 * pagination survives without JavaScript), while client tables pass
 * `onPageChange` and get buttons. Both modes render Prev, the page window with
 * ellipses (1 … 4 5 6 … 21), Next, and the "Showing x–y of n" summary, with
 * 44 px targets and `aria-current="page"` on the active page.
 */
export function Pagination({
	basePath,
	params,
	onPageChange,
	disabled = false,
	page,
	pageCount,
	showing,
	previousLabel,
	nextLabel,
	label = "Pagination",
}: PaginationProps) {
	const window = buildPageWindow(page, pageCount);
	const hasPrevious = page > 1;
	const hasNext = page < pageCount;
	const isCallback = typeof onPageChange === "function";

	const control = (
		target: number,
		content: ReactNode,
		options: {
			active?: boolean;
			ariaLabel?: string;
			rel?: "prev" | "next";
			key?: string | number;
			enabled?: boolean;
		} = {},
	) => {
		const { active = false, ariaLabel, rel, key, enabled = true } = options;
		const className = `${linkClass} ${active ? activeClass : enabled ? idleClass : disabledClass}`;

		if (!enabled) {
			return (
				<span key={key} aria-hidden="true" className={`${className} gap-1 px-2`}>
					{content}
				</span>
			);
		}

		if (isCallback) {
			return (
				<button
					key={key}
					type="button"
					onClick={() => onPageChange(target)}
					disabled={disabled}
					aria-label={ariaLabel}
					aria-current={active ? "page" : undefined}
					className={`${className} gap-1 px-2 disabled:cursor-not-allowed disabled:opacity-60`}
				>
					{content}
				</button>
			);
		}

		return (
			<Link
				key={key}
				href={buildPageHref(basePath ?? "/", params ?? {}, target)}
				rel={rel}
				aria-label={ariaLabel}
				aria-current={active ? "page" : undefined}
				className={`${className} gap-1 px-2`}
			>
				{content}
			</Link>
		);
	};

	return (
		<nav
			aria-label={label}
			className="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 dark:border-gray-700/50 sm:flex-row sm:items-center sm:justify-between"
		>
			{showing ? <p className="text-xs text-gray-500 dark:text-gray-400">{showing}</p> : <span />}
			<div className="flex items-center gap-1">
				{control(
					page - 1,
					<>
						<ChevronLeft className="size-4" aria-hidden="true" />
						<span className="hidden sm:inline">{previousLabel}</span>
					</>,
					{
						ariaLabel: previousLabel,
						rel: "prev",
						enabled: hasPrevious,
						key: "previous",
					},
				)}

				{window.map((item, index) =>
					item === "ellipsis" ? (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: ellipsis position is stable
							key={`ellipsis-${index}`}
							className="px-1 text-sm text-gray-400 dark:text-gray-500"
							aria-hidden="true"
						>
							…
						</span>
					) : (
						control(item, item, {
							active: item === page,
							ariaLabel: String(item),
							key: item,
						})
					),
				)}

				{control(
					page + 1,
					<>
						<span className="hidden sm:inline">{nextLabel}</span>
						<ChevronRight className="size-4" aria-hidden="true" />
					</>,
					{
						ariaLabel: nextLabel,
						rel: "next",
						enabled: hasNext,
						key: "next",
					},
				)}
			</div>
		</nav>
	);
}
