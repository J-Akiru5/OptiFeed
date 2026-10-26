import { Link } from "@/i18n/routing";
import { buildPageHref, buildPageWindow } from "@/lib/pagination";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
	basePath: string;
	/** Current query parameters, excluding `page`. Empty values are dropped. */
	params: Record<string, string | undefined>;
	page: number;
	pageCount: number;
	/** Pre-formatted summary, e.g. "Showing 1–10 of 42". */
	showing: string;
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

export function Pagination({
	basePath,
	params,
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

	return (
		<nav
			aria-label={label}
			className="flex flex-col gap-3 border-t border-gray-100 dark:border-gray-700/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
		>
			<p className="text-xs text-gray-500 dark:text-gray-400">{showing}</p>
			<div className="flex items-center gap-1">
				{hasPrevious ? (
					<Link
						href={buildPageHref(basePath, params, page - 1)}
						rel="prev"
						aria-label={previousLabel}
						className={`${linkClass} ${idleClass} gap-1 px-2`}
					>
						<ChevronLeft className="size-4" />
						<span className="hidden sm:inline">{previousLabel}</span>
					</Link>
				) : (
					<span aria-hidden="true" className={`${linkClass} ${disabledClass} gap-1 px-2`}>
						<ChevronLeft className="size-4" />
						<span className="hidden sm:inline">{previousLabel}</span>
					</span>
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
						<Link
							key={item}
							href={buildPageHref(basePath, params, item)}
							aria-current={item === page ? "page" : undefined}
							className={`${linkClass} ${item === page ? activeClass : idleClass}`}
						>
							{item}
						</Link>
					),
				)}

				{hasNext ? (
					<Link
						href={buildPageHref(basePath, params, page + 1)}
						rel="next"
						aria-label={nextLabel}
						className={`${linkClass} ${idleClass} gap-1 px-2`}
					>
						<span className="hidden sm:inline">{nextLabel}</span>
						<ChevronRight className="size-4" />
					</Link>
				) : (
					<span aria-hidden="true" className={`${linkClass} ${disabledClass} gap-1 px-2`}>
						<span className="hidden sm:inline">{nextLabel}</span>
						<ChevronRight className="size-4" />
					</span>
				)}
			</div>
		</nav>
	);
}
