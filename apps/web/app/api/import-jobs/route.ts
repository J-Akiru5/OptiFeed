import { accepted } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { resolveActivePond } from "@/lib/auth/pond-access";
import { requireWriteAccess } from "@/lib/auth/session";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import { type ImportableType, isImportableType } from "@/lib/csv";
import { MAX_CSV_IMPORT_BYTES } from "@/lib/jobs/import-data";
import { createJob } from "@/lib/jobs/service";
import { checkApiRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** A pond id is a Prisma cuid; anything much longer is not a real id. */
const MAX_POND_ID_LENGTH = 64;

interface ImportJobRequest {
	type: ImportableType;
	csvData: string;
	/** Pond captured at preview time; the worker writes every row here (#743). */
	pondId?: string;
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

		if (!isImportableType(body.type)) {
			return Response.json(
				{ error: "Invalid type. Audit events are export-only." },
				{ status: 400 },
			);
		}
		if (typeof body.csvData !== "string" || body.csvData.length === 0) {
			return Response.json({ error: "Missing type or csvData" }, { status: 400 });
		}
		if (body.csvData.length > MAX_CSV_IMPORT_BYTES) {
			return Response.json({ error: "CSV payload exceeds 5 MB" }, { status: 413 });
		}

		// The pond is part of the job, not resolved when the worker runs: a pond
		// switch between preview and confirm must not retarget the import.
		const pondId = typeof body.pondId === "string" ? body.pondId.trim() : "";
		if (pondId === "" || pondId.length > MAX_POND_ID_LENGTH) {
			return Response.json({ error: "Missing or invalid pondId" }, { status: 400 });
		}
		// Fail before queueing when the pond is archived, foreign or unknown.
		// The worker repeats the check because ownership can change while the
		// job waits in the queue.
		const pond = await resolveActivePond(ownerId, pondId);
		if (!pond) {
			return Response.json({ error: "Pond not found" }, { status: 404 });
		}

		// Persist the client's dedupe key with the job so the worker can honour
		// it. When the header is absent the worker derives one from the payload.
		const idempotencyKey = request.headers.get("idempotency-key");
		const job = await createJob({
			ownerId,
			requestedBy: user.id,
			type: "import_confirm",
			payload: {
				type: body.type,
				csvData: body.csvData,
				pondId,
				...(idempotencyKey ? { idempotencyKey } : {}),
			},
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
