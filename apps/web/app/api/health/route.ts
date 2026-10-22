import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Unauthenticated liveness probe for uptime monitoring.
 *
 * The body is deliberately minimal and identical in shape on both paths: an
 * anonymous caller learns only whether the database is reachable, never why it
 * is not (driver, host, credentials or failed query text). The failure detail
 * stays in the server log.
 */
export async function GET() {
	try {
		await prisma.$queryRaw`SELECT 1`;
		return Response.json({ status: "ok" });
	} catch (e) {
		console.error("[health] database probe failed:", e instanceof Error ? e.message : e);
		return Response.json({ status: "degraded" }, { status: 503 });
	}
}
