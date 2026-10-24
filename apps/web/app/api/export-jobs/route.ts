import { accepted } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import type { ExportableType } from "@/lib/csv";
import { BATCH_EXPORT_TYPES, CSV_EXPORT_TYPES } from "@/lib/jobs/export-data";
import { createJob } from "@/lib/jobs/service";
import { checkApiRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface ExportJobRequest {
	kind?: "csv" | "zip" | "pdf";
	type?: ExportableType;
	types?: ExportableType[];
}

export const POST = withApi(
	withAuth(async (request, { ownerId, user }) => {
		const { success } = await checkApiRateLimit(ownerId);
		if (!success) {
			return Response.json({ error: "Too Many Requests" }, { status: 429 });
		}

		let body: ExportJobRequest;
		try {
			body = await request.json();
		} catch {
			return Response.json({ error: "Invalid JSON body" }, { status: 400 });
		}

		const kind = body.kind === "zip" || body.kind === "pdf" ? body.kind : "csv";

		if (kind === "csv") {
			if (!body.type || !CSV_EXPORT_TYPES.includes(body.type)) {
				return Response.json(
					{ error: `Invalid type. Must be one of: ${CSV_EXPORT_TYPES.join(", ")}` },
					{ status: 400 },
				);
			}
		}

		const requestedTypes = Array.isArray(body.types)
			? body.types.filter((type) => BATCH_EXPORT_TYPES.includes(type))
			: [];

		if (kind === "zip" && Array.isArray(body.types) && requestedTypes.length === 0) {
			return Response.json(
				{ error: `Invalid types. Must be one of: ${BATCH_EXPORT_TYPES.join(", ")}` },
				{ status: 400 },
			);
		}

		const job =
			kind === "csv"
				? await createJob({
						ownerId,
						requestedBy: user.id,
						type: "export_csv",
						payload: { type: body.type },
					})
				: kind === "zip"
					? await createJob({
							ownerId,
							requestedBy: user.id,
							type: "export_zip",
							payload: { types: requestedTypes.length > 0 ? requestedTypes : BATCH_EXPORT_TYPES },
						})
					: await createJob({
							ownerId,
							requestedBy: user.id,
							type: "export_pdf",
							payload: {},
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
	{ route: "POST /api/export-jobs", timeoutMs: 5_000, sunset: LEGACY_API_SUNSET },
);
