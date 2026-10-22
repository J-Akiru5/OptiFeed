import { ok } from "@/lib/api/envelope";
import { notFound } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import { getJobForOwner, jobDto } from "@/lib/jobs/service";

export const dynamic = "force-dynamic";

interface RouteContext {
	params: Promise<{ id: string }>;
}

export const GET = withApi(
	withAuth(async (_request, { ownerId }, routeContext) => {
		const { id } = await (routeContext as RouteContext).params;
		const job = await getJobForOwner(ownerId, id);
		if (!job) throw notFound("Job not found.");
		return ok(jobDto(job), { headers: { "Cache-Control": "no-store" } });
	}),
	{ route: "GET /api/jobs/{id}", timeoutMs: 5_000, sunset: LEGACY_API_SUNSET },
);
