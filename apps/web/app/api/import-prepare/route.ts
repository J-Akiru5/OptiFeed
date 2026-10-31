import { ok } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { requireWriteAccess } from "@/lib/auth/session";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import { checkApiRateLimit } from "@/lib/rate-limit";
import { checkScheduleAgainstCap } from "@/lib/schedule/sheet";
import { prepareImport } from "@/lib/xlsx/prepare";
import { readUploadTable } from "@/lib/xlsx/read-upload";
import { isSheetType } from "@/lib/xlsx/schema";

export const dynamic = "force-dynamic";

/** `mapping` is JSON of canonical field → the file's own header; anything else is ignored. */
function parseMapping(raw: FormDataEntryValue | null): Record<string, string> {
	if (typeof raw !== "string" || raw === "") return {};
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
		return Object.fromEntries(
			Object.entries(value).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
	} catch {
		return {};
	}
}

export const POST = withApi(
	withAuth(async (request, { ownerId }) => {
		try {
			await requireWriteAccess();
		} catch {
			return Response.json({ error: "Write access required (ADMIN or OPERATOR)" }, { status: 403 });
		}

		const { success } = await checkApiRateLimit(ownerId);
		if (!success) {
			return Response.json({ error: "Too Many Requests" }, { status: 429 });
		}

		let form: FormData;
		try {
			form = await request.formData();
		} catch {
			return Response.json({ error: "Expected a multipart form upload" }, { status: 400 });
		}

		const type = form.get("type");
		if (!isSheetType(type)) {
			return Response.json({ error: "Invalid type" }, { status: 400 });
		}
		const file = form.get("file");
		if (!(file instanceof File) || file.size === 0) {
			return Response.json({ error: "Missing file" }, { status: 400 });
		}

		const upload = await readUploadTable(file.name, new Uint8Array(await file.arrayBuffer()), type);
		if (!upload.ok) {
			return Response.json({ error: upload.message }, { status: upload.status });
		}

		const prepared = prepareImport({
			type,
			headers: upload.table.headers,
			rows: upload.table.rows,
			overrides: parseMapping(form.get("mapping")),
			truncated: upload.table.truncated,
		});
		const capCheck = prepared.schedule
			? await checkScheduleAgainstCap(ownerId, prepared.schedule.feedsPerDay)
			: null;

		return ok({ ...prepared, fileName: file.name, capCheck });
	}),
	// Parsing a 5 MB workbook is CPU work; same guard as the CSV preview.
	{ route: "POST /api/import-prepare", timeoutMs: 20_000, sunset: LEGACY_API_SUNSET },
);
