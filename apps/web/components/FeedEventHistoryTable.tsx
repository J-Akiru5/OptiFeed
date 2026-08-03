"use client";

import { PaginatedSearchTable } from "@/components/ui/paginated-search-table";
import { type FeedEventListItem, getFeedEvents } from "@/lib/actions/history";
import { formatDateTimeLocal } from "@/lib/date-local";
import { CheckCircle2, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

interface FeedEventHistoryTableProps {
	deviceIds: string[];
	initialItems: FeedEventListItem[];
	initialHasMore: boolean;
	initialNextCursor: string | null;
}

export function FeedEventHistoryTable({
	deviceIds,
	initialItems,
	initialHasMore,
	initialNextCursor,
}: FeedEventHistoryTableProps) {
	const t = useTranslations("dashboard.history");
	const tDates = useTranslations("dates");

	const [items, setItems] = useState<FeedEventListItem[]>(initialItems);
	const [hasMore, setHasMore] = useState(initialHasMore);
	const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
	const [isLoading, setIsLoading] = useState(false);

	const queryRef = useRef("");
	const seqRef = useRef(0);

	const loadPage = async (cursor: string | null, query: string) => {
		const seq = ++seqRef.current;
		const result = await getFeedEvents({ deviceIds, cursor, query });
		if (seq !== seqRef.current) return null;
		return result;
	};

	const handleSearch = async (query: string) => {
		queryRef.current = query;
		setIsLoading(true);
		const result = await loadPage(null, query);
		if (!result) return;
		setItems(result.items);
		setHasMore(result.hasMore);
		setNextCursor(result.nextCursor);
		setIsLoading(false);
	};

	const handleLoadMore = async () => {
		if (isLoading || !nextCursor) return;
		setIsLoading(true);
		const result = await loadPage(nextCursor, queryRef.current);
		if (!result) return;
		setItems((prev) => [...prev, ...result.items]);
		setHasMore(result.hasMore);
		setNextCursor(result.nextCursor);
		setIsLoading(false);
	};

	const renderRow = (event: FeedEventListItem) => {
		const formatted = formatDateTimeLocal(event.receivedAt, tDates);
		const sourceKey =
			event.source && ["scheduled", "dashboard", "button"].includes(event.source)
				? event.source
				: "dashboard";
		return (
			<div className="flex items-center justify-between py-4">
				<div className="flex items-center gap-4">
					<div className="h-10 w-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
						<CheckCircle2 className="h-5 w-5" />
					</div>
					<div>
						<p className="font-semibold text-gray-900">{formatted.fullDate}</p>
						<p className="font-semibold text-gray-900 flex items-center gap-2">
							<span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 flex items-center gap-1">
								<Clock className="h-3 w-3" /> {formatted.time}
							</span>
						</p>
						<p className="text-sm text-gray-500 mt-0.5">
							{event.source ? t(`source_${sourceKey}`) : t("confirmedDispense")}
						</p>
					</div>
				</div>
				<div className="text-right">
					<p className="font-bold text-gray-900">{event.grams ?? 0}g</p>
				</div>
			</div>
		);
	};

	return (
		<PaginatedSearchTable<FeedEventListItem>
			items={items}
			renderRow={renderRow}
			getKey={(event) => event.id}
			hasMore={hasMore}
			onLoadMore={handleLoadMore}
			onSearch={handleSearch}
			isLoading={isLoading}
			searchPlaceholder={t("searchPlaceholder")}
			emptyMessage={t("noEvents")}
			loadMoreLabel={t("loadMore")}
			loadingLabel={t("loading")}
			className="p-6"
		/>
	);
}
