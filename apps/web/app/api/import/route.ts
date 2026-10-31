import { ok } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { resolveActivePond } from "@/lib/auth/pond-access";
import { requireWriteAccess } from "@/lib/auth/session";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import { type ExportableType, parseCsvString } from "@/lib/csv";
import { MAX_CSV_IMPORT_BYTES } from "@/lib/jobs/import-data";
import { checkApiRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface ImportPreviewRequest {
	type: ExportableType;
	csvData: string;
}

const REQUIRED_FIELDS: Record<ExportableType, string[]> = {
	biomass_logs: ["sampleWeightKg", "sampleCount"],
	fish_samples: ["biomassLogId", "weightGrams"],
	feed_events: ["eventType", "timestamp"],
	fcr_reports: ["periodStart", "periodEnd", "totalFeedKg", "biomassGainKg", "fcrValue"],
	feed_level_logs: ["levelPercent", "distanceCm"],
	notifications: ["tier", "message"],
	audit_events: ["eventType", "source"],
};

export const POST = withApi(
	withAuth(async (request, { ownerId }) => {
		try {
			await requireWriteAccess();
		} catch {
			return Response.json({ error: "Write access required (ADMIN or OPERATOR)" }, { status: 403 });
		}

		// Rate limit: 30 requests per 60 seconds per user
		const { success } = await checkApiRateLimit(ownerId);
		if (!success) {
			return Response.json({ error: "Too Many Requests" }, { status: 429 });
		}

		const pond = await resolveActivePond(ownerId);
		if (!pond) {
			return Response.json({ error: "No pond found" }, { status: 404 });
		}

		let body: ImportPreviewRequest;
		try {
			body = await request.json();
		} catch {
			return Response.json({ error: "Invalid JSON body" }, { status: 400 });
		}

		const { type, csvData } = body;
		if (!type || !Object.hasOwn(REQUIRED_FIELDS, type)) {
			return Response.json({ error: "Invalid type" }, { status: 400 });
		}
		if (typeof csvData !== "string" || csvData.length === 0) {
			return Response.json({ error: "Missing type or csvData" }, { status: 400 });
		}
		if (csvData.length > MAX_CSV_IMPORT_BYTES) {
			return Response.json({ error: "CSV payload exceeds 5 MB" }, { status: 413 });
		}

		const { data, errors: parseErrors } = parseCsvString(csvData);

		const requiredFields = REQUIRED_FIELDS[type] || [];
		const validationErrors: { row: number; field: string; message: string }[] = [];

		if (parseErrors.length > 0) {
			for (const err of parseErrors.slice(0, 10)) {
				validationErrors.push({
					row: err.row ?? 0,
					field: err.type,
					message: err.message,
				});
			}
		}

		for (let i = 0; i < data.length; i++) {
			const row = data[i];
			for (const field of requiredFields) {
				if (row[field] === null || row[field] === undefined || row[field] === "") {
					validationErrors.push({
						row: i + 1,
						field,
						message: `Required field "${field}" is missing or empty`,
					});
				}
			}
		}

		return ok({
			totalRows: data.length,
			preview: data.slice(0, 10),
			validationErrors: validationErrors.slice(0, 50),
			isValid: validationErrors.length === 0,
		});
	}),
	// §8.2 rule 11 exception, tracked in docs/api-regulation-backlog.md:
	// parsing a 5 000-row CSV is CPU work. It keeps a 15 s guard (the Prisma
	// transaction is capped at 30 s) until it moves to a background job that
	// returns `202 Accepted`.
	{ route: "POST /api/import", timeoutMs: 15_000, sunset: LEGACY_API_SUNSET },
);
