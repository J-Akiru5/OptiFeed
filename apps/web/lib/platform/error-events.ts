import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import type { ErrorSeverity } from "@/lib/error-scrub";
import { parsePage, resolvePagination } from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { getListPageSize } from "@/lib/settings/platform";
import type { Prisma } from "@prisma/client";

/**
 * Platform error console (mission 2026-10-29e, I-64).
 *
 * Read side of the first-party error capture. Every entry point requires an
 * active PlatformAdmin row before it touches the table; the page repeats the
 * check so neither layer alone is load-bearing.
 *
 * The list is newest-first by `lastSeenAt` because the row is a dedupe bucket,
 * not an occurrence log: the most recently active error is what operations
 * needs first.
 */

export const ERROR_EVENT_STATUSES = ["unresolved", "resolved", "all"] as const;
export type ErrorEventStatus = (typeof ERROR_EVENT_STATUSES)[number];

export interface ErrorEventFilters {
	status: ErrorEventStatus;
	page: number;
}

export interface ErrorEventRow {
	id: string;
	message: string;
	stack: string | null;
	route: string;
	severity: ErrorSeverity;
	count: number;
	firstSeenAt: Date;
	lastSeenAt: Date;
	resolved: boolean;
	resolvedAt: Date | null;
	resolvedBy: string | null;
}

export interface ErrorEventListResult {
	rows: ErrorEventRow[];
	total: number;
	page: number;
	pageSize: number;
}

const ROW_SELECT = {
	id: true,
	message: true,
	stack: true,
	route: true,
	severity: true,
	count: true,
	firstSeenAt: true,
	lastSeenAt: true,
	resolved: true,
	resolvedAt: true,
	resolvedBy: true,
} as const;

function first(value: string | string[] | undefined): string | undefined {
	const raw = Array.isArray(value) ? value[0] : value;
	if (typeof raw !== "string") return undefined;
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** Read the console filters from a URL. Unresolved is the default view. */
export function parseErrorEventFilters(
	params: Record<string, string | string[] | undefined>,
): ErrorEventFilters {
	const raw = first(params.status);
	const status: ErrorEventStatus = raw === "resolved" || raw === "all" ? raw : "unresolved";

	return { status, page: parsePage(first(params.page)) };
}

/** The one `where` builder shared by the list and the pager. */
export function buildErrorEventWhere(filters: ErrorEventFilters): Prisma.ErrorEventWhereInput {
	if (filters.status === "all") return {};
	return { resolved: filters.status === "resolved" };
}

export async function listErrorEvents(filters: ErrorEventFilters): Promise<ErrorEventListResult> {
	await requirePlatformAdmin();

	const pageSize = await getListPageSize();
	const where = buildErrorEventWhere(filters);

	const [total, firstFetch] = await Promise.all([
		prisma.errorEvent.count({ where }),
		prisma.errorEvent.findMany({
			where,
			orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
			skip: (filters.page - 1) * pageSize,
			take: pageSize,
			select: ROW_SELECT,
		}),
	]);

	const paging = resolvePagination(filters.page, pageSize, total);
	const rows =
		paging.page === filters.page
			? firstFetch
			: await prisma.errorEvent.findMany({
					where,
					orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
					skip: paging.offset,
					take: paging.pageSize,
					select: ROW_SELECT,
				});

	return { rows, total, page: paging.page, pageSize: paging.pageSize };
}
