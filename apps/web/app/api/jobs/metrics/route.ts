import { ok } from "@/lib/api/envelope";
import { forbidden } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { getCurrentUserRole } from "@/lib/auth/session";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import { getJobMetrics } from "@/lib/jobs/service";

export const dynamic = "force-dynamic";

export const GET = withApi(
	withAuth(async (_request, { ownerId }) => {
		const role = await getCurrentUserRole();
		if (role !== "ADMIN") throw forbidden("Admin access required.");
		return ok(await getJobMetrics(ownerId), { headers: { "Cache-Control": "no-store" } });
	}),
	{ route: "GET /api/jobs/metrics", timeoutMs: 5_000, sunset: LEGACY_API_SUNSET },
);
