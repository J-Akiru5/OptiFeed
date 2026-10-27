"use client";

import { Pagination } from "@/components/ui/pagination";
import { type FeedEventListItem, getFeedEvents } from "@/lib/actions/history";
import { formatFarmDateTime } from "@/lib/date-local";
import { feedSourceKey } from "@/lib/feed-sources";
import { CheckCircle2, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

interface FeedEventHistoryTableProps {
	deviceIds: string[];
	initialItems: FeedEventListItem[];
	initialTotal: number;
	pageSize: number;
}

/**
 * Numbered feeding-event log (decision E1).
 *
 * Page changes and searches each call `getFeedEvents` exactly once. The
 * debounced search fires only after the user types (never on mount or while
 * idle), and a sequence guard drops an older response that arrives late.
 */
export function FeedEventHistoryTable({
	deviceIds,
	initialItems,
	initialTotal,
	pageSize,
}: FeedEventHistoryTableProps) {
	const t = useTranslations("dashboard.history");
	const tCommon = useTranslations("dashboard.common");
	const tDates = useTranslations("dates");

	const [items, setItems] = useState<FeedEventListItem[]>(initialItems);
	const [total, setTotal] = useState(initialTotal);
	const [page, setPage] = useState(1);
	const [isLoading, setIsLoading] = useState(false);
	const [query, setQuery] = useState("");

	const queryRef = useRef("");
	const seqRef = useRef(0);

	const loadPage = async (targetPage: number, query: string) => {
		const seq = ++seqRef.current;
		const result = await getFeedEvents({ deviceIds, page: targetPage, pageSize, query });
		if (seq !== seqRef.current) return null;
		return result;
	};

	const fetchPage = async (targetPage: number) => {
		setIsLoading(true);
		try {
			const result = await loadPage(targetPage, queryRef.current);
			if (!result) return;
			setItems(result.items);
			setTotal(result.total);
			setPage(result.page);
		} catch {
			// Keep the current page; the next click retries.
		} finally {
			setIsLoading(false);
		}
	};

	const handleSearch = async (query: string) => {
		queryRef.current = query;
		await fetchPage(1);
	};

	// Debounce the search and skip the mount run: an idle table must issue no
	// server action at all (see e2e/search-loop.spec.ts). The handler is kept in
	// a ref so the effect depends only on the typed query.
	const handleSearchRef = useRef(handleSearch);
	handleSearchRef.current = handleSearch;
	const hasMounted = useRef(false);
	useEffect(() => {
		if (!hasMounted.current) {
			hasMounted.current = true;
			return;
		}
		const timer = setTimeout(() => void handleSearchRef.current(query.trim()), 300);
		return () => clearTimeout(timer);
	}, [query]);

	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
	const lastRow = Math.min(page * pageSize, total);

	const renderRow = (event: FeedEventListItem) => {
		const formatted = formatFarmDateTime(event.receivedAt, tDates);
		const sourceKey = feedSourceKey(event.source);
		return (
			<div className="flex items-center justify-between py-4">
				<div className="flex items-center gap-4">
					<div className="h-10 w-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
						<CheckCircle2 className="h-5 w-5" />
					</div>
					<div>
						<p className="font-semibold text-gray-900 dark:text-gray-100">{formatted.fullDate}</p>
						<p className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
							<span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 flex items-center gap-1">
								<Clock className="h-3 w-3" /> {formatted.time}
							</span>
						</p>
						<p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
							{event.source ? t(`source_${sourceKey}`) : t("confirmedDispense")}
						</p>
					</div>
				</div>
				<div className="text-right">
					<p className="font-bold text-gray-900 dark:text-gray-100">{event.grams ?? 0}g</p>
				</div>
			</div>
		);
	};

	return (
		<div className="w-full p-6">
			<div className="relative mb-4">
				<input
					type="text"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={t("searchPlaceholder")}
					className="w-full rounded-lg border border-gray-200 bg-white py-2 pr-4 pl-4 text-sm text-gray-700 outline-none placeholder:text-gray-400 focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
				/>
			</div>

			{isLoading && items.length === 0 ? (
				<div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
					{t("loading")}
				</div>
			) : items.length === 0 ? (
				<div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
					{t("noEvents")}
				</div>
			) : (
				<div className="divide-y divide-gray-100 dark:divide-gray-700/50">
					{items.map((event) => (
						<div key={event.id}>{renderRow(event)}</div>
					))}
				</div>
			)}

			{total > 0 && (
				<Pagination
					onPageChange={(target) => {
						if (!isLoading) void fetchPage(target);
					}}
					disabled={isLoading}
					page={page}
					pageCount={pageCount}
					showing={tCommon("pagination.showing", {
						from: firstRow,
						to: lastRow,
						total,
					})}
					previousLabel={tCommon("pagination.previous")}
					nextLabel={tCommon("pagination.next")}
					label={tCommon("pagination.label")}
				/>
			)}
		</div>
	);
}
