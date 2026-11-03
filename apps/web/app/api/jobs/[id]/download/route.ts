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

/**
 * Postgres bytea is returned whole by a normal Prisma read. The artifact can be
 * up to 25 MB, so the download streams it in bounded `substring` chunks instead
 * of buffering the blob in function memory (#728). Chunks are 1 MiB; a 25 MB
 * artifact is 25 small reads rather than one 25 MB allocation.
 */
const ARTIFACT_CHUNK_BYTES = 1024 * 1024;

function artifactTooLarge(): ApiError {
	const limitMb = Math.floor(MAX_JOB_ARTIFACT_BYTES / (1024 * 1024));
	return new ApiError(
		413,
		"PAYLOAD_TOO_LARGE",
		`This export exceeds the ${limitMb} MB download limit.`,
		{ expose: true },
	);
}

function streamArtifact(jobId: string, totalBytes: number): ReadableStream<Uint8Array> {
	let offset = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (offset >= totalBytes) {
				controller.close();
				return;
			}
			const rows = await prisma.$queryRaw<Array<{ chunk: Uint8Array | null }>>`
				SELECT substring("data" FROM ${offset + 1} FOR ${ARTIFACT_CHUNK_BYTES}) AS chunk
				FROM "JobArtifact"
				WHERE "jobId" = ${jobId}
			`;
			const chunk = rows[0]?.chunk;
			if (!chunk || chunk.byteLength === 0) {
				controller.close();
				return;
			}
			offset += chunk.byteLength;
			controller.enqueue(new Uint8Array(chunk));
		},
	});
}

export const GET = withApi(
	withAuth(async (_request, { ownerId }, routeContext) => {
		const { id } = await (routeContext as RouteContext).params;
		const job = await getJobForOwner(ownerId, id);
		if (!job) throw notFound("Job not found.");
		if (job.status !== "succeeded" || !job.artifact) {
			throw conflict("The export is not ready yet.");
		}

		// The metadata size is checked before any bytea is read; an oversized
		// stored artifact is refused without pulling it into function memory.
		if (job.artifact.size > MAX_JOB_ARTIFACT_BYTES) throw artifactTooLarge();

		const filename = job.artifact.filename.replace(/["\\]/g, "_");

		return new Response(streamArtifact(id, job.artifact.size), {
			headers: {
				"Content-Type": job.artifact.contentType,
				"Content-Length": String(job.artifact.size),
				"Content-Disposition": `attachment; filename="${filename}"`,
				"Cache-Control": "private, no-store",
			},
		});
	}),
	{ route: "GET /api/jobs/{id}/download", timeoutMs: 15_000, sunset: LEGACY_API_SUNSET },
);
