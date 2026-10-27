import { fail } from "@/lib/api/envelope";
import { forbidden, unauthorized } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { isCurrentPlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getVerifiedSession } from "@/lib/auth/verify-session";
import {
	AUDIT_EXPORT_LIMIT,
	buildPlatformAuditWhere,
	fetchAuditExportRows,
	parseAuditFilters,
	resolveAuditActorIds,
	streamAuditCsv,
} from "@/lib/platform/audit-log";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * CSV export of the filtered platform audit log (E16.4, task I-15).
 *
 * Platform-admin only. The session is checked here rather than through
 * `withAuth` because a platform admin is not required to be a tenant member
 * (E18), so there may be no farm binding to resolve. The filter `where` is the
 * same builder the explorer uses, and the generator stops at
 * `AUDIT_EXPORT_LIMIT` (5000) rows in 200-row batches, so the response streams
 * and memory stays bounded.
 */
export const GET = withApi(
	async (request) => {
		const session = await getVerifiedSession();
		if (!session) return fail(unauthorized());
		if (!(await isCurrentPlatformAdmin())) {
			return fail(forbidden("Platform access is required."));
		}

		const url = new URL(request.url);
		const params: Record<string, string> = {};
		for (const [key, value] of url.searchParams.entries()) params[key] = value;
		const filters = parseAuditFilters(params);
		const actorUserIds = filters.actor ? await resolveAuditActorIds(filters.actor) : null;
		const where = buildPlatformAuditWhere(filters, actorUserIds);

		const rows = streamAuditCsv((offset, take) => fetchAuditExportRows(where, offset, take));
		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			async pull(controller) {
				try {
					const next = await rows.next();
					if (next.done) {
						controller.close();
						return;
					}
					controller.enqueue(encoder.encode(next.value));
				} catch (error) {
					// The response has already started, so the only honest thing
					// left is to break the stream rather than serve a silent
					// half-file.
					controller.error(error);
				}
			},
			async cancel() {
				await rows.return(undefined);
			},
		});

		const filename = `platform-audit-${new Date().toISOString().slice(0, 10)}.csv`;
		return new NextResponse(body, {
			headers: {
				"Content-Type": "text/csv; charset=utf-8",
				"Content-Disposition": `attachment; filename="${filename}"`,
				"Cache-Control": "no-store",
				"X-Export-Limit": String(AUDIT_EXPORT_LIMIT),
			},
		});
	},
	{
		route: "GET /api/platform/audit/export",
		shape: "passthrough",
		timeoutMs: 15_000,
		slowMs: 3_000,
		violationMs: 15_000,
	},
);
