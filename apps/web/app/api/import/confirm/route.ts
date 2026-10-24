import { ok } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { requireWriteAccess } from "@/lib/auth/session";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import type { ExportableType } from "@/lib/csv";
import { confirmImport } from "@/lib/jobs/import-data";
import { checkApiRateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

interface ImportConfirmRequest {
	type: ExportableType;
	csvData: string;
}

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

		let body: ImportConfirmRequest;
		try {
			body = await request.json();
		} catch {
			return Response.json({ error: "Invalid JSON body" }, { status: 400 });
		}

		const { type, csvData } = body;
		if (!type || !csvData) {
			return Response.json({ error: "Missing type or csvData" }, { status: 400 });
		}

		const result = await confirmImport(ownerId, type, csvData);

		revalidatePath("/[locale]/(dashboard)/dashboard", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard/growth", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard/history", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard/audit", "page");

		return ok({ success: true, importedCount: result.importedCount });
	}),
	// Synchronous compatibility path; new clients should use
	// POST /api/v1/import-jobs.
	{ route: "POST /api/import/confirm", timeoutMs: 35_000, sunset: LEGACY_API_SUNSET },
);
