import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import type { ExportableType } from "@/lib/csv";
import { BATCH_EXPORT_TYPES, buildBatchExport } from "@/lib/jobs/export-data";
import { checkApiRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const GET = withApi(
	withAuth(async (request, { ownerId }) => {
		// Rate limit: 30 requests per 60 seconds per user
		const { success } = await checkApiRateLimit(ownerId);
		if (!success) {
			return Response.json({ error: "Too Many Requests" }, { status: 429 });
		}

		const { searchParams } = new URL(request.url);
		const typesParam = searchParams.get("types");
		const types = typesParam
			? typesParam.split(",").filter((type) => BATCH_EXPORT_TYPES.includes(type as ExportableType))
			: BATCH_EXPORT_TYPES;

		// A `types` filter that matches nothing must not become a successful empty
		// ZIP: the caller asked for something the endpoint cannot export.
		if (typesParam && types.length === 0) {
			return Response.json(
				{ error: `Invalid types. Must be one of: ${BATCH_EXPORT_TYPES.join(", ")}` },
				{ status: 400 },
			);
		}

		const artifact = await buildBatchExport(ownerId, types as ExportableType[]);

		return new Response(artifact.body, {
			headers: {
				"Content-Type": artifact.contentType,
				"Content-Disposition": `attachment; filename="${artifact.filename}"`,
				// Tenant data: never let a shared cache or the browser keep it.
				"Cache-Control": "private, no-store",
			},
		});
	}),
	// Synchronous compatibility path; new clients should use POST
	// /api/v1/export-jobs with kind=zip.
	{ route: "GET /api/export/batch", timeoutMs: 20_000, sunset: LEGACY_API_SUNSET },
);
