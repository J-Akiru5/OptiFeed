import { ApiError, conflict, notFound } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET, MAX_JOB_ARTIFACT_BYTES } from "@/lib/constants";
import { getJobForOwner } from "@/lib/jobs/service";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
	params: Promise<{ id: string }>;
}

function artifactTooLarge(): ApiError {
	const limitMb = Math.floor(MAX_JOB_ARTIFACT_BYTES / (1024 * 1024));
	return new ApiError(
		413,
		"PAYLOAD_TOO_LARGE",
		`This export exceeds the ${limitMb} MB download limit.`,
		{ expose: true },
	);
}

export const GET = withApi(
	withAuth(async (_request, { ownerId }, routeContext) => {
		const { id } = await (routeContext as RouteContext).params;
		const job = await getJobForOwner(ownerId, id);
		if (!job) throw notFound("Job not found.");
		if (job.status !== "succeeded" || !job.artifact) {
			throw conflict("The export is not ready yet.");
		}

		// Check the metadata before loading the bytea: an oversized stored
		// artifact must be refused without pulling it into function memory.
		if (job.artifact.size > MAX_JOB_ARTIFACT_BYTES) throw artifactTooLarge();

		const artifact = await prisma.jobArtifact.findUnique({ where: { jobId: id } });
		if (!artifact) throw notFound("Export artifact not found.");
		// Defensive second check for a row whose stored size disagrees with its
		// bytes. The real Content-Length below always comes from the bytes.
		if (artifact.data.byteLength > MAX_JOB_ARTIFACT_BYTES) throw artifactTooLarge();

		const filename = artifact.filename.replace(/["\\]/g, "_");

		// `artifact.data` is already a Uint8Array/Buffer and is a valid
		// Response body; passing it directly avoids the second full copy.
		return new Response(artifact.data, {
			headers: {
				"Content-Type": artifact.contentType,
				"Content-Length": String(artifact.data.byteLength),
				"Content-Disposition": `attachment; filename="${filename}"`,
				"Cache-Control": "private, no-store",
			},
		});
	}),
	{ route: "GET /api/jobs/{id}/download", timeoutMs: 15_000, sunset: LEGACY_API_SUNSET },
);
