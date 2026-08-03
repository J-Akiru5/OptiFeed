"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, Search } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * PaginatedSearchTable
 *
 * Generic, presentational cursor-paginated list with a debounced search input.
 * It owns NO data — the parent supplies rows, a "load more" handler, and a
 * search callback.
 *
 * CURSOR CONTRACT — mirror the pattern already used by server actions such as
 * `getAuditLog()` in apps/web/lib/actions/audit.ts:
 *   - fetch `take + 1` rows,
 *   - `hasMore = rows.length > take`,
 *   - the last returned row's timestamp (e.g. `createdAt`) is the `nextCursor`
 *     the caller passes back for the following page.
 *
 * EXAMPLE server action feeding this component:
 *   const PAGE_SIZE = 50;
 *   export async function getEvents(cursor?: string, query = "") {
 *     const where = query ? { name: { contains: query } } : {};
 *     const rows = await prisma.feedEvent.findMany({
 *       where,
 *       orderBy: { receivedAt: "desc" },
 *       take: PAGE_SIZE + 1, // peek one extra row to detect `hasMore`
 *       cursor: cursor ? { receivedAt: new Date(cursor) } : undefined,
 *       skip: cursor ? 1 : 0,
 *     });
 *     const hasMore = rows.length > PAGE_SIZE;
 *     const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
 *     return {
 *       items,
 *       hasMore,
 *       nextCursor: hasMore ? items.at(-1)?.receivedAt.toISOString() : null,
 *     };
 *   }
 *
 * EXAMPLE client wrapper (required: `renderRow` and the callbacks cannot cross
 * the RSC boundary, so render this component from a `"use client"` component,
 * never directly from a server page):
 *   <PaginatedSearchTable<FeedEvent>
 *     items={items}
 *     renderRow={(event) => <EventRow event={event} />}
 *     hasMore={hasMore}
 *     onLoadMore={() => setCursor(nextCursor)}
 *     onSearch={(q) => setQuery(q)}
 *     isLoading={isLoading}
 *     emptyMessage="No events found"
 *   />
 */
interface PaginatedSearchTableProps<T> {
	items: T[];
	renderRow: (item: T) => ReactNode;
	/** Stable key per row. Defaults to the row index when omitted. */
	getKey?: (item: T, index: number) => string | number;
	hasMore: boolean;
	onLoadMore: () => void;
	onSearch: (query: string) => void;
	isLoading: boolean;
	searchDebounceMs?: number;
	searchPlaceholder?: string;
	emptyMessage?: string;
	loadMoreLabel?: string;
	loadingLabel?: string;
	className?: string;
}

export function PaginatedSearchTable<T>({
	items,
	renderRow,
	getKey,
	hasMore,
	onLoadMore,
	onSearch,
	isLoading,
	searchDebounceMs = 300,
	searchPlaceholder = "Search…",
	emptyMessage = "No results",
	loadMoreLabel = "Load more",
	loadingLabel = "Loading…",
	className,
}: PaginatedSearchTableProps<T>) {
	const [query, setQuery] = useState("");
	const hasMounted = useRef(false);

	useEffect(() => {
		if (!hasMounted.current) {
			hasMounted.current = true;
			return;
		}
		const timer = setTimeout(() => onSearch(query.trim()), searchDebounceMs);
		return () => clearTimeout(timer);
	}, [query, onSearch, searchDebounceMs]);

	const showEmpty = !isLoading && items.length === 0;

	return (
		<div className={cn("w-full", className)}>
			<div className="relative mb-4">
				<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-gray-400" />
				<input
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={searchPlaceholder}
					className="w-full rounded-lg border border-gray-200 py-2 pr-4 pl-9 text-sm text-gray-700 outline-none placeholder:text-gray-400 focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
				/>
			</div>

			{isLoading && items.length === 0 ? (
				<div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
					<Loader2 className="size-4 animate-spin" />
					<span>{loadingLabel}</span>
				</div>
			) : showEmpty ? (
				<div className="py-10 text-center text-sm text-gray-500">{emptyMessage}</div>
			) : (
				<div className="divide-y divide-gray-100">
					{items.map((item, index) => {
						const rowKey = getKey?.(item, index) ?? index;
						return <div key={rowKey}>{renderRow(item)}</div>;
					})}
				</div>
			)}

			{hasMore && (
				<div className="mt-4 flex justify-center">
					<Button type="button" variant="outline" onClick={onLoadMore} disabled={isLoading}>
						{isLoading && <Loader2 className="size-4 animate-spin" />}
						{isLoading ? loadingLabel : loadMoreLabel}
					</Button>
				</div>
			)}
		</div>
	);
}
