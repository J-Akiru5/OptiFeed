/**
 * Small, dependency-free helpers for URL-driven pagination and date filters.
 *
 * Kept pure so they can be unit tested without a database or a request.
 */

export interface DateRange {
	gte?: Date;
	lt?: Date;
}

/** Clamp a raw `page` query value to a positive integer. */
export function parsePage(value: string | null | undefined): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed) || parsed < 1) return 1;
	return Math.min(parsed, 100_000);
}

/** Parse a `YYYY-MM-DD` query value as UTC midnight. Returns null if invalid. */
export function parseDateParam(value: string | null | undefined): Date | null {
	if (!value) return null;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const date = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(date.getTime())) return null;
	// Reject overflow such as 2026-02-31, which Date normalises to March.
	if (date.toISOString().slice(0, 10) !== value) return null;
	return date;
}

/**
 * Build an inclusive `from` / exclusive `to` range from two date inputs.
 * A reversed range is swapped so a mistaken order still returns data.
 */
export function resolveDateRange(
	from: string | null | undefined,
	to: string | null | undefined,
): DateRange | undefined {
	const start = parseDateParam(from);
	const end = parseDateParam(to);

	if (!start && !end) return undefined;

	let gte = start ?? undefined;
	let lt: Date | undefined;
	if (end) {
		lt = new Date(end);
		lt.setUTCDate(lt.getUTCDate() + 1);
	}
	if (gte && lt && gte >= lt) {
		// Swap: `from` after `to`.
		const swappedStart = new Date(end as Date);
		const swappedEnd = new Date(start as Date);
		swappedEnd.setUTCDate(swappedEnd.getUTCDate() + 1);
		gte = swappedStart;
		lt = swappedEnd;
	}

	return { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
}

/** Number of pages for a total row count. Always at least 1. */
export function getPageCount(total: number, pageSize: number): number {
	if (pageSize <= 0) return 1;
	return Math.max(1, Math.ceil(total / pageSize));
}

/** Clamp a requested page into the range that actually has rows. */
export function clampPage(page: number, pageCount: number): number {
	if (!Number.isFinite(page) || page < 1) return 1;
	return Math.min(Math.floor(page), Math.max(1, pageCount));
}

export interface PaginationState {
	/** The page after clamping, never outside 1…pageCount. */
	page: number;
	pageSize: number;
	total: number;
	pageCount: number;
	/** 1-based index of the first row, or 0 for an empty list. */
	firstRow: number;
	/** 1-based index of the last row, or 0 for an empty list. */
	lastRow: number;
	/** Prisma `skip` value for this page. */
	offset: number;
}

/**
 * Resolve everything a paginated query and its pager need from a requested
 * page, the configured page size and the total row count. Clamping here means
 * a stale `?page=99` renders the last real page instead of an empty one.
 */
export function resolvePagination(page: number, pageSize: number, total: number): PaginationState {
	const safeSize = Math.max(1, Math.floor(pageSize) || 1);
	const safeTotal = Math.max(0, Math.floor(total) || 0);
	const pageCount = getPageCount(safeTotal, safeSize);
	const safePage = clampPage(page, pageCount);
	const offset = (safePage - 1) * safeSize;
	const firstRow = safeTotal === 0 ? 0 : offset + 1;
	const lastRow = safeTotal === 0 ? 0 : Math.min(offset + safeSize, safeTotal);
	return {
		page: safePage,
		pageSize: safeSize,
		total: safeTotal,
		pageCount,
		firstRow,
		lastRow,
		offset,
	};
}

export type PageItem = number | "ellipsis";

/**
 * Build the visible page window, e.g. `[1, "ellipsis", 8, 9, 10, 11, 12,
 * "ellipsis", 20]`, so long histories stay usable without rendering 200 links.
 */
export function buildPageWindow(current: number, pageCount: number, span = 5): PageItem[] {
	if (pageCount <= 0) return [];
	const safeSpan = Math.max(3, span);
	if (pageCount <= safeSpan + 2) {
		return Array.from({ length: pageCount }, (_, index) => index + 1);
	}

	const half = Math.floor(safeSpan / 2);
	let start = Math.max(1, Math.min(current, pageCount) - half);
	const end = Math.min(pageCount, start + safeSpan - 1);
	start = Math.max(1, end - safeSpan + 1);

	const items: PageItem[] = [];
	if (start > 1) {
		items.push(1);
		if (start > 2) items.push("ellipsis");
	}
	for (let page = start; page <= end; page += 1) items.push(page);
	if (end < pageCount) {
		if (end < pageCount - 1) items.push("ellipsis");
		items.push(pageCount);
	}
	return items;
}

/** Build a URL for `page`, dropping empty filters and the default first page. */
export function buildPageHref(
	basePath: string,
	params: Record<string, string | undefined>,
	page: number,
): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (key === "page") continue;
		if (value === undefined || value === "") continue;
		search.set(key, value);
	}
	if (page > 1) search.set("page", String(page));
	const query = search.toString();
	return query ? `${basePath}?${query}` : basePath;
}
