import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import { buildPdfExport } from "@/lib/jobs/pdf-export";

export const dynamic = "force-dynamic";

export const GET = withApi(
	withAuth(async (_request, { ownerId }) => {
		const artifact = await buildPdfExport(ownerId);
		return new Response(artifact.body, {
			headers: {
				"Content-Type": artifact.contentType,
				"Content-Disposition": `attachment; filename="${artifact.filename}"`,
			},
		});
	}),
	// Synchronous compatibility path; new clients should use
	// POST /api/v1/export-jobs with kind=pdf.
	{ route: "GET /api/export-pdf", timeoutMs: 15_000, sunset: LEGACY_API_SUNSET },
);
