import { conflict, notFound } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import { getJobForOwner } from "@/lib/jobs/service";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
	params: Promise<{ id: string }>;
}

export const GET = withApi(
	withAuth(async (_request, { ownerId }, routeContext) => {
		const { id } = await (routeContext as RouteContext).params;
		const job = await getJobForOwner(ownerId, id);
		if (!job) throw notFound("Job not found.");
		if (job.status !== "succeeded" || !job.artifact) {
			throw conflict("The export is not ready yet.");
		}

		const artifact = await prisma.jobArtifact.findUnique({ where: { jobId: id } });
		if (!artifact) throw notFound("Export artifact not found.");

		const filename = artifact.filename.replace(/["\\]/g, "_");

		return new Response(new Uint8Array(artifact.data), {
			headers: {
				"Content-Type": artifact.contentType,
				"Content-Length": String(artifact.size),
				"Content-Disposition": `attachment; filename="${filename}"`,
				"Cache-Control": "private, no-store",
			},
		});
	}),
	{ route: "GET /api/jobs/{id}/download", timeoutMs: 15_000, sunset: LEGACY_API_SUNSET },
);
