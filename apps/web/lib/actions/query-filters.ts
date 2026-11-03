import { dateToFarmDateOnly } from "@/lib/crop-cycle/dates";
import { FEED_EVENT_SOURCES } from "@/lib/feed-sources";
import { resolveFarmDateRange } from "@/lib/pagination";

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
 * - Any parseable date filters that farm calendar day (Asia/Manila midnight
 *   to the next midnight), so a record at 00:30 PHT is not missed.
 * - Anything else yields no filter.
 */
export function parseQueryFilters(query: string): QueryFilters {
	const q = query.trim().toLowerCase();
	if (!q) return {};

	const source = FEED_SOURCES.find((s) => s === q);
	if (source) return { source };

	const parsed = new Date(q);
	if (Number.isNaN(parsed.getTime())) return {};

	const farmDate = dateToFarmDateOnly(parsed);
	const range = resolveFarmDateRange(farmDate, farmDate);
	const gte = range?.gte;
	const lt = range?.lt;
	if (!gte || !lt) return {};

	return { recordedBetween: { gte, lt } };
}
