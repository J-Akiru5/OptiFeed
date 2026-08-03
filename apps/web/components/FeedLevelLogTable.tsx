"use client";

import { PaginatedSearchTable } from "@/components/ui/paginated-search-table";
import { type FeedLevelLogListItem, getFeedLevelLogs } from "@/lib/actions/growth";
import { formatDateTimeLocal } from "@/lib/date-local";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

interface FeedLevelLogTableProps {
	deviceId: string;
	initialItems: FeedLevelLogListItem[];
	initialHasMore: boolean;
	initialNextCursor: string | null;
}

function levelBadgeClass(levelPercent: number): string {
	if (levelPercent <= 5) return "bg-red-100 text-red-700";
	if (levelPercent <= 20) return "bg-amber-100 text-amber-700";
	return "bg-green-100 text-green-700";
}

export function FeedLevelLogTable({
	deviceId,
	initialItems,
	initialHasMore,
	initialNextCursor,
}: FeedLevelLogTableProps) {
	const t = useTranslations("dashboard.growth");
	const tDates = useTranslations("dates");

	const [items, setItems] = useState<FeedLevelLogListItem[]>(initialItems);
	const [hasMore, setHasMore] = useState(initialHasMore);
	const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
	const [isLoading, setIsLoading] = useState(false);

	const queryRef = useRef("");
	const seqRef = useRef(0);

	const loadPage = async (cursor: string | null, query: string) => {
		const seq = ++seqRef.current;
		const result = await getFeedLevelLogs({ deviceId, cursor, query });
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

	const renderRow = (log: FeedLevelLogListItem) => (
		<div className="flex items-center justify-between py-4">
			<div className="font-medium text-gray-900 whitespace-nowrap">
				{formatDateTimeLocal(log.recordedAt, tDates).fullDate}
			</div>
			<div>
				<span
					className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${levelBadgeClass(log.levelPercent)}`}
				>
					{Math.round(log.levelPercent)}%
				</span>
			</div>
			<div className="font-mono">{log.distanceCm.toFixed(1)} cm</div>
		</div>
	);

	return (
		<PaginatedSearchTable<FeedLevelLogListItem>
			items={items}
			renderRow={renderRow}
			getKey={(log) => log.id}
			hasMore={hasMore}
			onLoadMore={handleLoadMore}
			onSearch={handleSearch}
			isLoading={isLoading}
			searchPlaceholder={t("searchPlaceholder")}
			emptyMessage={t("noFeedLevel")}
			loadMoreLabel={t("loadMore")}
			loadingLabel={t("loading")}
			className="p-6"
		/>
	);
}
