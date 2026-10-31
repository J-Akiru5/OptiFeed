import { accepted } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import { BATCH_EXPORT_TYPES, SHEET_EXPORT_TYPES } from "@/lib/jobs/export-data";
import { createJob } from "@/lib/jobs/service";
import { checkApiRateLimit } from "@/lib/rate-limit";
import { PDF_REPORTS, type PdfReport, type SheetType } from "@/lib/xlsx/schema";

export const dynamic = "force-dynamic";

interface ExportJobRequest {
	kind?: "csv" | "zip" | "xlsx" | "pdf";
	type?: SheetType;
	types?: SheetType[];
	report?: PdfReport;
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

		const kind =
			body.kind === "zip" || body.kind === "xlsx" || body.kind === "pdf" ? body.kind : "csv";

		if (kind === "csv") {
			if (!body.type || !SHEET_EXPORT_TYPES.includes(body.type)) {
				return Response.json(
					{ error: `Invalid type. Must be one of: ${SHEET_EXPORT_TYPES.join(", ")}` },
					{ status: 400 },
				);
			}
		}

		if (kind === "pdf" && body.report !== undefined && !PDF_REPORTS.includes(body.report)) {
			return Response.json(
				{ error: `Invalid report. Must be one of: ${PDF_REPORTS.join(", ")}` },
				{ status: 400 },
			);
		}

		const allowedTypes = kind === "xlsx" ? SHEET_EXPORT_TYPES : BATCH_EXPORT_TYPES;
		const requestedTypes = Array.isArray(body.types)
			? body.types.filter((type) => allowedTypes.includes(type))
			: [];

		// `types` was supplied but none of them is exportable — including a
		// non-array value, which used to fall through and silently export every
		// type instead of rejecting the request.
		if (
			(kind === "zip" || kind === "xlsx") &&
			body.types !== undefined &&
			requestedTypes.length === 0
		) {
			return Response.json(
				{ error: `Invalid types. Must be one of: ${allowedTypes.join(", ")}` },
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
					: kind === "xlsx"
						? await createJob({
								ownerId,
								requestedBy: user.id,
								type: "export_xlsx",
								payload: { types: requestedTypes.length > 0 ? requestedTypes : SHEET_EXPORT_TYPES },
							})
						: await createJob({
								ownerId,
								requestedBy: user.id,
								type: "export_pdf",
								payload: { report: body.report ?? "summary" },
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
