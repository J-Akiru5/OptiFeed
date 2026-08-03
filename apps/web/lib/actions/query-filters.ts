const FEED_SOURCES = ["scheduled", "dashboard", "button"] as const;

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
 * - Any parseable date filters the UTC calendar day (from 00:00 to 24:00).
 * - Anything else yields no filter.
 */
export function parseQueryFilters(query: string): QueryFilters {
	const q = query.trim().toLowerCase();
	if (!q) return {};

	const source = FEED_SOURCES.find((s) => s === q);
	if (source) return { source };

	const parsed = new Date(q);
	if (Number.isNaN(parsed.getTime())) return {};

	const gte = new Date(parsed);
	gte.setUTCHours(0, 0, 0, 0);
	const lt = new Date(gte);
	lt.setUTCDate(lt.getUTCDate() + 1);

	return { recordedBetween: { gte, lt } };
}
