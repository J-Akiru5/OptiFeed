import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import { checkApiRateLimit } from "@/lib/rate-limit";
import { isSheetType } from "@/lib/xlsx/schema";
import { buildTemplateCsv, buildTemplateWorkbookBuffer } from "@/lib/xlsx/writer";

export const dynamic = "force-dynamic";

export const GET = withApi(
	withAuth(async (request, { ownerId }) => {
		const { success } = await checkApiRateLimit(ownerId);
		if (!success) {
			return Response.json({ error: "Too Many Requests" }, { status: 429 });
		}

		const params = new URL(request.url).searchParams;
		const type = params.get("type");
		if (!isSheetType(type)) {
			return Response.json({ error: "Invalid type" }, { status: 400 });
		}

		const xlsx = params.get("format") === "xlsx";
		const body = xlsx ? await buildTemplateWorkbookBuffer(type) : buildTemplateCsv(type);
		return new Response(body, {
			headers: {
				"Content-Type": xlsx
					? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
					: "text/csv; charset=utf-8",
				"Content-Disposition": `attachment; filename="pakaonai_template_${type}.${xlsx ? "xlsx" : "csv"}"`,
				"Cache-Control": "private, no-store",
			},
		});
	}),
	{ route: "GET /api/import-template", timeoutMs: 10_000, sunset: LEGACY_API_SUNSET },
);
