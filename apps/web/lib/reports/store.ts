import prisma from "@/lib/prisma";
import { z } from "zod";

/**
 * Issue reports submitted from the public landing page (issue #487).
 *
 * This is the only writer for `IssueReport`: the route validates with the same
 * schema before calling it, and it validates again here so a future caller
 * (the in-app assistant entry point) cannot bypass the contract.
 *
 * `message` is free text and may contain personal data. It is never logged —
 * not on validation failure and not on a database error — only written.
 */

export const ISSUE_REPORT_CATEGORIES = ["BUG", "ACCESSIBILITY", "CONTENT", "OTHER"] as const;
export const ISSUE_REPORT_SOURCES = ["PUBLIC", "ASSISTANT"] as const;

export const ISSUE_REPORT_MESSAGE_MIN = 10;
export const ISSUE_REPORT_MESSAGE_MAX = 2_000;
export const ISSUE_REPORT_EMAIL_MAX = 200;
export const ISSUE_REPORT_PAGE_PATH_MAX = 300;
export const ISSUE_REPORT_LOCALE_MAX = 10;
export const ISSUE_REPORT_USER_ID_MAX = 40;

/** Trimmed optional text; blank becomes `null` so the column stays clean. */
const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.nullish()
		.transform((value) => (value && value.length > 0 ? value : null));

/**
 * A supplied address must parse as an email; `null` is the "not provided"
 * state. Validation runs after trimming, so trailing spaces do not reject an
 * otherwise valid address.
 */
const optionalEmail = optionalText(ISSUE_REPORT_EMAIL_MAX).refine(
	(value) => value === null || z.email().safeParse(value).success,
	"Enter a valid email address",
);

/** cuid/uuid-shaped actor id; no spaces, no free text. */
const optionalUserId = optionalText(ISSUE_REPORT_USER_ID_MAX).refine(
	(value) => value === null || /^[A-Za-z0-9_-]+$/.test(value),
	"Invalid reporter id",
);

export const issueReportInputSchema = z.object({
	category: z.enum(ISSUE_REPORT_CATEGORIES).default("OTHER"),
	message: z
		.string()
		.trim()
		.min(ISSUE_REPORT_MESSAGE_MIN, "Describe the issue in at least 10 characters")
		.max(ISSUE_REPORT_MESSAGE_MAX, "Keep the report under 2000 characters"),
	email: optionalEmail,
	pagePath: optionalText(ISSUE_REPORT_PAGE_PATH_MAX),
	locale: optionalText(ISSUE_REPORT_LOCALE_MAX),
	source: z.enum(ISSUE_REPORT_SOURCES).default("PUBLIC"),
	reporterUserId: optionalUserId,
});

export type IssueReportInput = z.input<typeof issueReportInputSchema>;

export type CreateIssueReportResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Validate and persist one report.
 *
 * Returns the new row id on success. On failure the caller gets a coarse code
 * (`invalid` or `unavailable`) — never a validation echo, so an anonymous
 * client cannot probe the schema through the error string.
 */
export async function createIssueReport(input: IssueReportInput): Promise<CreateIssueReportResult> {
	const parsed = issueReportInputSchema.safeParse(input);
	if (!parsed.success) return { ok: false, error: "invalid" };

	try {
		const report = await prisma.issueReport.create({
			data: {
				category: parsed.data.category,
				message: parsed.data.message,
				email: parsed.data.email,
				pagePath: parsed.data.pagePath,
				locale: parsed.data.locale,
				source: parsed.data.source,
				reporterUserId: parsed.data.reporterUserId,
			},
			select: { id: true },
		});
		return { ok: true, id: report.id };
	} catch (error) {
		// The message body (and any Prisma error meta that could carry it) must
		// stay out of the log; the failure type is enough to page on.
		console.error(
			"[issue-reports] could not store report:",
			error instanceof Error ? error.name : "unknown error",
		);
		return { ok: false, error: "unavailable" };
	}
}
