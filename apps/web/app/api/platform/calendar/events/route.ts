import { ok } from "@/lib/api/envelope";
import { forbidden } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { isCurrentPlatformAdmin } from "@/lib/auth/require-platform-admin";
import { withAuth } from "@/lib/auth/with-auth";
import {
	loadPlatformCalendarData,
	parsePlatformCalendarQuery,
} from "@/lib/calendar/platform-events";

export const dynamic = "force-dynamic";

/**
 * Platform calendar data (E16.2). Read-only and platform-gated: the session
 * must belong to an active PlatformAdmin row, exactly like the console pages.
 */
export const GET = withApi(
	withAuth(async (request) => {
		if (!(await isCurrentPlatformAdmin())) {
			throw forbidden("Platform access is required.");
		}

		const url = new URL(request.url);
		const params: Record<string, string> = {};
		for (const [key, value] of url.searchParams.entries()) params[key] = value;

		const data = await loadPlatformCalendarData(parsePlatformCalendarQuery(params));
		return ok(data, { headers: { "Cache-Control": "no-store" } });
	}),
	{
		route: "GET /api/platform/calendar/events",
		timeoutMs: 8_000,
		slowMs: 3_000,
		violationMs: 8_000,
	},
);
