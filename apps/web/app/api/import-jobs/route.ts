import { accepted } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { requireWriteAccess } from "@/lib/auth/session";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import type { ExportableType } from "@/lib/csv";
import { CSV_EXPORT_TYPES } from "@/lib/jobs/export-data";
import { createJob } from "@/lib/jobs/service";
import { checkApiRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface ImportJobRequest {
	type: ExportableType;
	csvData: string;
}

export const POST = withApi(
	withAuth(async (request, { ownerId, user }) => {
		try {
			await requireWriteAccess();
		} catch {
			return Response.json({ error: "Write access required (ADMIN or OPERATOR)" }, { status: 403 });
		}

		const { success } = await checkApiRateLimit(ownerId);
		if (!success) {
			return Response.json({ error: "Too Many Requests" }, { status: 429 });
		}

		let body: ImportJobRequest;
		try {
			body = await request.json();
		} catch {
			return Response.json({ error: "Invalid JSON body" }, { status: 400 });
		}

		if (!body.type || !CSV_EXPORT_TYPES.includes(body.type)) {
			return Response.json(
				{ error: `Invalid type. Must be one of: ${CSV_EXPORT_TYPES.join(", ")}` },
				{ status: 400 },
			);
		}
		if (typeof body.csvData !== "string" || body.csvData.length === 0) {
			return Response.json({ error: "Missing type or csvData" }, { status: 400 });
		}
		if (body.csvData.length > 5 * 1024 * 1024) {
			return Response.json({ error: "CSV payload exceeds 5 MB" }, { status: 413 });
		}

		const job = await createJob({
			ownerId,
			requestedBy: user.id,
			type: "import_confirm",
			payload: { type: body.type, csvData: body.csvData },
		});

		return accepted(
			{
				id: job.id,
				type: job.type,
				status: job.status,
				status_url: `/api/v1/jobs/${job.id}`,
			},
			`/api/v1/jobs/${job.id}`,
		);
	}),
	{ route: "POST /api/import-jobs", timeoutMs: 5_000, sunset: LEGACY_API_SUNSET },
);
