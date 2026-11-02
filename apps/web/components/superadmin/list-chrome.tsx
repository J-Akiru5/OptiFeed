import { SECONDARY_BUTTON } from "@/components/superadmin/ui";
import { Search } from "lucide-react";
import type { ReactNode } from "react";

/**
 * List chrome shared by the platform console's paginated pages
 * (users, organizations, ponds, devices): one search form, so the four pages
 * look and behave the same. Numbered pagination itself is the shared
 * `components/ui/pagination.tsx` used by every list in the product.
 *
 * `action` is the locale-aware URL from `getPathname`, resolved by the page.
 */
export function ListToolbar({
	id,
	action,
	query,
	label,
	placeholder,
	searchLabel,
	children,
}: {
	/** Unique id prefix for the label/input pair. */
	id: string;
	action: string;
	query: string;
	/** Accessible name for the search field. */
	label: string;
	placeholder: string;
	/** Visible text on the submit button. */
	searchLabel: string;
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
						data-help="superadmin-search"
						defaultValue={query}
						placeholder={placeholder}
						autoComplete="off"
						enterKeyHint="search"
						className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white dark:bg-[#111A2C] px-3 py-2 text-sm text-[#0A3D62] transition-all placeholder:text-[#3D5568]/70 focus:outline-none focus:ring-2 focus:ring-[#E85A2A] dark:border-[#24304A] dark:bg-[#0B1220] dark:text-slate-100 dark:placeholder:text-slate-500"
					/>
					<button type="submit" className={SECONDARY_BUTTON}>
						<Search className="h-3.5 w-3.5" aria-hidden="true" />
						{searchLabel}
					</button>
				</form>
			</search>
			{children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
		</div>
	);
}
