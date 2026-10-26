import { SECONDARY_BUTTON } from "@/components/superadmin/ui";
import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

type Href = ComponentProps<typeof Link>["href"];

/**
 * List chrome shared by the platform console's paginated pages
 * (users, organizations, ponds, devices): one search form and one
 * previous/next bar, so the four pages look and behave the same.
 *
 * `action` is the locale-aware URL from `getPathname`, resolved by the page.
 */
export function ListToolbar({
	id,
	action,
	query,
	label,
	placeholder,
	children,
}: {
	/** Unique id prefix for the label/input pair. */
	id: string;
	action: string;
	query: string;
	label: string;
	placeholder: string;
	children?: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<search className="w-full sm:max-w-md">
				<form action={action} method="get" className="flex w-full items-center gap-2">
					<label htmlFor={`${id}-search`} className="sr-only">
						{label}
					</label>
					<input
						id={`${id}-search`}
						name="q"
						type="search"
						defaultValue={query}
						placeholder={placeholder}
						autoComplete="off"
						enterKeyHint="search"
						className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-[#0A3D62] transition-all placeholder:text-[#3D5568]/70 focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
					/>
					<button type="submit" className={SECONDARY_BUTTON}>
						<Search className="h-3.5 w-3.5" aria-hidden="true" />
						Search
					</button>
				</form>
			</search>
			{children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
		</div>
	);
}

/**
 * Previous / next pager. Rendered outside the table card at every breakpoint,
 * so the mobile card list and the md+ table use the same control.
 * Pass `null` for a direction that is not available.
 */
export function ListPagination({
	label,
	page,
	pageCount,
	previousHref,
	nextHref,
}: {
	/** Accessible name for the nav landmark, e.g. "User pages". */
	label: string;
	page: number;
	pageCount: number;
	previousHref: Href | null;
	nextHref: Href | null;
}) {
	if (pageCount <= 1) return null;

	return (
		<nav
			aria-label={label}
			className="flex flex-wrap items-center justify-between gap-3 text-xs font-black"
		>
			<span className="text-[#3D5568]">
				Page {page} of {pageCount}
			</span>
			<div className="flex items-center gap-2">
				{previousHref ? (
					<Link href={previousHref} rel="prev" className={cn(SECONDARY_BUTTON, "px-3 py-1.5")}>
						<span aria-hidden="true">←</span> Previous
					</Link>
				) : (
					<span
						aria-hidden="true"
						className="inline-flex items-center rounded-xl border border-gray-200 px-3 py-1.5 text-[#3D5568]/50"
					>
						← Previous
					</span>
				)}
				{nextHref ? (
					<Link href={nextHref} rel="next" className={cn(SECONDARY_BUTTON, "px-3 py-1.5")}>
						Next <span aria-hidden="true">→</span>
					</Link>
				) : (
					<span
						aria-hidden="true"
						className="inline-flex items-center rounded-xl border border-gray-200 px-3 py-1.5 text-[#3D5568]/50"
					>
						Next →
					</span>
				)}
			</div>
		</nav>
	);
}
