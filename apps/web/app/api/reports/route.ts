import { withApi } from "@/lib/api/instrumentation";
import { getClientIp } from "@/lib/client-ip";
import { checkIssueReportRateLimit } from "@/lib/rate-limit";
import { createIssueReport, issueReportInputSchema } from "@/lib/reports/store";

/**
 * Public "Report an issue" submission (issue #487).
 *
 * Deliberately unauthenticated: the box lives on the landing page, before
 * sign-in. Abuse control is the per-IP limiter plus the honeypot below, not a
 * session.
 *
 * Every rejection answers with the same generic message, so a probe cannot
 * learn which check failed (JSON shape, honeypot, length or email format).
 */

const INVALID_REQUEST = "Invalid request";
const SAVE_FAILED = "Could not save the report";
// The longest valid report is ~2 KB; anything far past that is not a browser
// submission and does not need to be parsed.
const MAX_BODY_BYTES = 16 * 1024;

export const POST = withApi(
	async (request: Request) => {
		const ip = await getClientIp();
		const { success } = await checkIssueReportRateLimit(ip);
		if (!success) {
			return Response.json({ error: "Too many requests" }, { status: 429 });
		}

		const declaredLength = Number(request.headers.get("content-length") ?? 0);
		if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
			return Response.json({ error: INVALID_REQUEST }, { status: 400 });
		}

		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return Response.json({ error: INVALID_REQUEST }, { status: 400 });
		}

		if (body === null || typeof body !== "object" || Array.isArray(body)) {
			return Response.json({ error: INVALID_REQUEST }, { status: 400 });
		}

		const record = body as Record<string, unknown>;

		// Honeypot: hidden from sighted users and removed from the tab order, so a
		// non-empty value means a script filled it. Answer exactly like any other
		// malformed submission and say nothing about the field.
		if (typeof record.website === "string" && record.website.trim().length > 0) {
			return Response.json({ error: INVALID_REQUEST }, { status: 400 });
		}

		// `source` and `reporterUserId` are not read from the body: the public form
		// is always a PUBLIC report, and it cannot name an account.
		const parsed = issueReportInputSchema.safeParse({
			category: record.category,
			message: record.message,
			email: record.email,
			pagePath: record.pagePath,
			locale: record.locale,
		});
		if (!parsed.success) {
			return Response.json({ error: INVALID_REQUEST }, { status: 400 });
		}

		try {
			const result = await createIssueReport(parsed.data);
			if (!result.ok) {
				return Response.json({ error: SAVE_FAILED }, { status: 500 });
			}
			return Response.json({ ok: true }, { status: 201 });
		} catch (error) {
			// Never include request content in the log line.
			console.error(
				"[reports] unexpected error:",
				error instanceof Error ? error.name : "unknown error",
			);
			return Response.json({ error: SAVE_FAILED }, { status: 500 });
		}
	},
	{ route: "POST /api/reports" },
);
