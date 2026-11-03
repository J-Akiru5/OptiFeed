import { manilaDayRange } from "@/lib/date-local";
import { FEED_EVENT_SOURCES } from "@/lib/feed-sources";

const FEED_SOURCES = FEED_EVENT_SOURCES;

export type SourceFilter = (typeof FEED_SOURCES)[number];

export interface QueryFilters {
	source?: SourceFilter;
	recordedBetween?: { gte: Date; lt: Date };
}

/**
 * Parses a free-text search query into Prisma-compatible filters.
 *
 * - An exact source token ("scheduled" | "dashboard" | "button") filters by
 *   that feed source.
 * - Any parseable date filters the Asia/Manila calendar day, not the UTC day
 *   (an 00:30 PHT record is stored on the previous UTC date).
 * - Anything else yields no filter.
 */
export function parseQueryFilters(query: string): QueryFilters {
	const q = query.trim().toLowerCase();
	if (!q) return {};

	const source = FEED_SOURCES.find((s) => s === q);
	if (source) return { source };

	const parsed = new Date(q);
	if (Number.isNaN(parsed.getTime())) return {};

	const { start, end } = manilaDayRange(parsed.getTime());
	return { recordedBetween: { gte: start, lt: end } };
}
