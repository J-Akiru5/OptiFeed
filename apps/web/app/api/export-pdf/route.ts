import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import { buildPdfExport } from "@/lib/jobs/pdf-export";
import { checkApiRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const GET = withApi(
	withAuth(async (_request, { ownerId }) => {
		// The PDF is the most expensive synchronous generator, so it carries the
		// same per-user limit as /api/export, /api/export/batch and /api/export-jobs.
		const { success } = await checkApiRateLimit(ownerId);
		if (!success) {
			return Response.json({ error: "Too Many Requests" }, { status: 429 });
		}

		const artifact = await buildPdfExport(ownerId);
		return new Response(artifact.body, {
			headers: {
				"Content-Type": artifact.contentType,
				"Content-Disposition": `attachment; filename="${artifact.filename}"`,
				// Tenant data: never let a shared cache or the browser keep it.
				"Cache-Control": "private, no-store",
			},
		});
	}),
	// Synchronous compatibility path; new clients should use
	// POST /api/v1/export-jobs with kind=pdf.
	{ route: "GET /api/export-pdf", timeoutMs: 15_000, sunset: LEGACY_API_SUNSET },
);
