"use server";

import { parseQueryFilters } from "@/lib/actions/query-filters";
import prisma from "@/lib/prisma";

const PAGE_SIZE = 50;

export interface FeedEventListItem {
	id: string;
	receivedAt: Date;
	source: string | null;
	grams: number | null;
}

export interface FeedEventPage {
	items: FeedEventListItem[];
	hasMore: boolean;
	nextCursor: string | null;
}

export async function getFeedEvents(params: {
	deviceIds: string[];
	cursor?: string | null;
	query?: string;
}): Promise<FeedEventPage> {
	const filters = parseQueryFilters(params.query ?? "");
	const rows = await prisma.feedEvent.findMany({
		where: {
			deviceId: { in: params.deviceIds },
			eventType: "feed_dispensed",
			...(filters.source ? { source: filters.source } : {}),
			...(filters.recordedBetween ? { receivedAt: filters.recordedBetween } : {}),
		},
		orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
		take: PAGE_SIZE + 1,
		...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
		select: { id: true, receivedAt: true, source: true, grams: true },
	});

	const hasMore = rows.length > PAGE_SIZE;
	const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

	return {
		items,
		hasMore,
		nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
	};
}
