"use server";

import { parseQueryFilters } from "@/lib/actions/query-filters";
import { getCurrentPondOwnerId } from "@/lib/auth/session";
import { resolvePagination } from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { normalizeListPageSize } from "@/lib/settings/platform";

export interface FeedEventListItem {
	id: string;
	receivedAt: Date;
	source: string | null;
	grams: number | null;
}

export interface FeedEventPage {
	items: FeedEventListItem[];
	total: number;
	page: number;
	pageSize: number;
}

/**
 * One numbered page of the feeding event log (decision E1, issue #187).
 *
 * The client table owns the page state and calls this once per search or page
 * change. `pageSize` comes from the server render as a prop, so the client never
 * decides the app-wide page size; it is clamped here anyway because a server
 * action is still a public entry point.
 */
export async function getFeedEvents(params: {
	deviceIds: string[];
	page?: number;
	pageSize?: number;
	query?: string;
}): Promise<FeedEventPage> {
	const ownerId = await getCurrentPondOwnerId();
	const pageSize = normalizeListPageSize(params.pageSize);

	const validDevices = await prisma.energyDevice.findMany({
		where: { id: { in: params.deviceIds }, pond: { ownerId } },
		select: { id: true },
	});
	const validIds = validDevices.map((d) => d.id);

	const filters = parseQueryFilters(params.query ?? "");
	const where = {
		deviceId: { in: validIds },
		eventType: "feed_dispensed",
		...(filters.source ? { source: filters.source } : {}),
		...(filters.recordedBetween ? { receivedAt: filters.recordedBetween } : {}),
	};
	const requestedPage = Math.max(1, Math.floor(params.page ?? 1) || 1);

	const [total, firstFetch] = await Promise.all([
		prisma.feedEvent.count({ where }),
		prisma.feedEvent.findMany({
			where,
			orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
			skip: (requestedPage - 1) * pageSize,
			take: pageSize,
			select: { id: true, receivedAt: true, source: true, grams: true },
		}),
	]);

	const paging = resolvePagination(requestedPage, pageSize, total);
	const items =
		paging.page === requestedPage
			? firstFetch
			: await prisma.feedEvent.findMany({
					where,
					orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
					skip: paging.offset,
					take: paging.pageSize,
					select: { id: true, receivedAt: true, source: true, grams: true },
				});

	return {
		items,
		total,
		page: paging.page,
		pageSize: paging.pageSize,
	};
}
