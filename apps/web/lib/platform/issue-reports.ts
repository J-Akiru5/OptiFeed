import prisma from "@/lib/prisma";

/**
 * Public and assistant issue reports (issue #487).
 *
 * Read side of the report queue. The page guards with
 * `requirePlatformAdmin()`; this loader intentionally has no auth of its own so
 * the platform console can reuse it for future surfaces (counts, exports).
 *
 * The list is newest-first and bounded: the console is a triage queue, not an
 * archive, so one page never pulls an unbounded number of rows.
 */

export type IssueReportCategory = "BUG" | "ACCESSIBILITY" | "CONTENT" | "OTHER";
export type IssueReportSource = "PUBLIC" | "ASSISTANT";
export type IssueReportStatus = "OPEN" | "RESOLVED";

export interface IssueReportRow {
	id: string;
	category: IssueReportCategory;
	message: string;
	email: string | null;
	pagePath: string | null;
	locale: string | null;
	source: IssueReportSource;
	status: IssueReportStatus;
	createdAt: string;
	resolvedAt: string | null;
}

export const ISSUE_REPORT_DEFAULT_LIMIT = 50;
export const ISSUE_REPORT_MAX_LIMIT = 100;

const ROW_SELECT = {
	id: true,
	category: true,
	message: true,
	email: true,
	pagePath: true,
	locale: true,
	source: true,
	status: true,
	createdAt: true,
	resolvedAt: true,
} as const;

/** The queue loads 50 rows by default and never more than 100. */
function clampLimit(limit: number): number {
	if (!Number.isFinite(limit)) return ISSUE_REPORT_DEFAULT_LIMIT;
	return Math.min(ISSUE_REPORT_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

export async function listIssueReports(
	limit = ISSUE_REPORT_DEFAULT_LIMIT,
): Promise<IssueReportRow[]> {
	const rows = await prisma.issueReport.findMany({
		select: ROW_SELECT,
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: clampLimit(limit),
	});

	return rows.map((row) => ({
		id: row.id,
		category: row.category,
		message: row.message,
		email: row.email,
		pagePath: row.pagePath,
		locale: row.locale,
		source: row.source,
		status: row.status,
		createdAt: row.createdAt.toISOString(),
		resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
	}));
}
