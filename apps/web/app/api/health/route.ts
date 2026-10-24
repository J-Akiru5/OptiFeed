import { withApi } from "@/lib/api/instrumentation";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Unauthenticated liveness probe for uptime monitoring.
 *
 * The body is deliberately minimal and identical in shape on both paths: an
 * anonymous caller learns only whether the database is reachable, never why it
 * is not (driver, host, credentials or failed query text). The failure detail
 * stays in the server log.
 *
 * Shape: `passthrough` — this is an infrastructure probe with an external
 * contract (uptime monitors), not a browser JSON endpoint, so the regulation's
 * §4 envelope does not apply. `Server-Timing` and `X-Request-Id` still do.
 */
export const GET = withApi(
	async () => {
		try {
			await prisma.$queryRaw`SELECT 1`;
			return Response.json({ status: "ok" });
		} catch (e) {
			console.error("[health] database probe failed:", e instanceof Error ? e.message : e);
			return Response.json({ status: "degraded" }, { status: 503 });
		}
	},
	{ route: "GET /api/health", shape: "passthrough", cacheControl: "no-store" },
);
