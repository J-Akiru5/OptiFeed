import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import type { ExportableType } from "@/lib/csv";
import { CSV_EXPORT_TYPES, buildCsvExport } from "@/lib/jobs/export-data";
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
		const type = searchParams.get("type") as ExportableType | null;

		if (!type || !CSV_EXPORT_TYPES.includes(type)) {
			return Response.json(
				{ error: `Invalid type. Must be one of: ${CSV_EXPORT_TYPES.join(", ")}` },
				{ status: 400 },
			);
		}

		const artifact = await buildCsvExport(ownerId, type);

		return new Response(artifact.body, {
			headers: {
				"Content-Type": artifact.contentType,
				"Content-Disposition": `attachment; filename="${artifact.filename}"`,
				// Tenant data: never let a shared cache or the browser keep it.
				"Cache-Control": "private, no-store",
			},
		});
	}),
	// File download: the success body is CSV, so the envelope applies only to
	// error responses. Synchronous compatibility path; new clients should use
	// POST /api/v1/export-jobs.
	{ route: "GET /api/export", timeoutMs: 15_000, sunset: LEGACY_API_SUNSET },
);
