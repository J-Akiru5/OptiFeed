import { farmIdFromEmail } from "@/lib/auth/session";
import { type ExportableType, parseCsvString } from "@/lib/csv";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface ImportPreviewRequest {
	type: ExportableType;
	csvData: string;
}

const REQUIRED_FIELDS: Record<ExportableType, string[]> = {
	biomass_logs: ["sampleWeightKg", "sampleCount"],
	feed_events: ["eventType", "timestamp"],
	fcr_reports: ["periodStart", "periodEnd", "totalFeedKg", "biomassGainKg", "fcrValue"],
	feed_level_logs: ["levelPercent", "distanceCm"],
	notifications: ["tier", "message"],
	audit_events: ["eventType", "source"],
};

export async function POST(request: Request) {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

	const ownerId = user?.email ? farmIdFromEmail(user.email) : null;
	if (!ownerId) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const pond = await prisma.pond.findFirst({ where: { ownerId } });
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
	if (!type || !csvData) {
		return Response.json({ error: "Missing type or csvData" }, { status: 400 });
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

	return Response.json({
		totalRows: data.length,
		preview: data.slice(0, 10),
		validationErrors: validationErrors.slice(0, 50),
		isValid: validationErrors.length === 0,
	});
}
