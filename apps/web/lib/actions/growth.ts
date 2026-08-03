"use server";

import { parseQueryFilters } from "@/lib/actions/query-filters";
import prisma from "@/lib/prisma";

const PAGE_SIZE = 30;

export interface FeedLevelLogListItem {
	id: string;
	recordedAt: Date;
	levelPercent: number;
	distanceCm: number;
}

export interface FeedLevelLogPage {
	items: FeedLevelLogListItem[];
	hasMore: boolean;
	nextCursor: string | null;
}

export async function getFeedLevelLogs(params: {
	deviceId: string;
	cursor?: string | null;
	query?: string;
}): Promise<FeedLevelLogPage> {
	const filters = parseQueryFilters(params.query ?? "");
	const rows = await prisma.feedLevelLog.findMany({
		where: {
			deviceId: params.deviceId,
			...(filters.recordedBetween ? { recordedAt: filters.recordedBetween } : {}),
		},
		orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
		take: PAGE_SIZE + 1,
		...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
		select: { id: true, recordedAt: true, levelPercent: true, distanceCm: true },
	});

	const hasMore = rows.length > PAGE_SIZE;
	const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

	return {
		items,
		hasMore,
		nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
	};
}
