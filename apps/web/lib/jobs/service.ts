import { ApiError } from "@/lib/api/errors";
import type { ExportableType } from "@/lib/csv";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import type { PdfReport, SheetType } from "@/lib/xlsx/schema";
import type { BackgroundJob, Prisma } from "@prisma/client";
import { buildBatchExport, buildCsvExport, buildXlsxExport } from "./export-data";
import { confirmImport } from "./import-data";
import { buildPdfExport } from "./pdf-export";
import { buildReportPdf } from "./report-pdf";

export const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const STALE_LOCK_MS = 5 * 60 * 1000;

export type JobType = "export_csv" | "export_zip" | "export_xlsx" | "export_pdf" | "import_confirm";
type JobStatus = "queued" | "running" | "succeeded" | "failed";

interface CreateJobInput {
	ownerId: string;
	requestedBy?: string | null;
	type: JobType;
	payload: Prisma.InputJsonValue;
	ttlMs?: number;
}

export interface JobDto {
	id: string;
	type: string;
	status: string;
	attempts: number;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
	expires_at: string;
	result: unknown;
	error: string | null;
	status_url: string;
	download_url: string | null;
}

export async function createJob(input: CreateJobInput): Promise<BackgroundJob> {
	return prisma.backgroundJob.create({
		data: {
			ownerId: input.ownerId,
			requestedBy: input.requestedBy ?? null,
			type: input.type,
			payload: input.payload,
			expiresAt: new Date(Date.now() + (input.ttlMs ?? JOB_TTL_MS)),
		},
	});
}

export async function getJobForOwner(
	ownerId: string,
	jobId: string,
): Promise<
	| (BackgroundJob & { artifact: { filename: string; contentType: string; size: number } | null })
	| null
> {
	return prisma.backgroundJob.findFirst({
		where: { id: jobId, ownerId },
		include: {
			artifact: { select: { filename: true, contentType: true, size: true } },
		},
	});
}

export function jobDto(
	job: BackgroundJob & {
		artifact?: { filename: string; contentType: string; size: number } | null;
	},
): JobDto {
	return {
		id: job.id,
		type: job.type,
		status: job.status,
		attempts: job.attempts,
		created_at: job.createdAt.toISOString(),
		started_at: job.startedAt?.toISOString() ?? null,
		finished_at: job.finishedAt?.toISOString() ?? null,
		expires_at: job.expiresAt.toISOString(),
		result: job.result,
		error: job.error,
		status_url: `/api/v1/jobs/${job.id}`,
		download_url:
			job.status === "succeeded" && job.artifact ? `/api/v1/jobs/${job.id}/download` : null,
	};
}

/**
 * Atomically claim one queued job. `FOR UPDATE SKIP LOCKED` lets several
 * workers run without double-processing; a crashed worker's lease is recovered
 * by `requeueStaleJobs`.
 */
export async function claimNextJob(workerId: string): Promise<BackgroundJob | null> {
	const rows = await prisma.$queryRaw<BackgroundJob[]>`
		UPDATE "BackgroundJob"
		SET "status" = 'running',
			"lockedAt" = (NOW() AT TIME ZONE 'UTC'),
			"lockedBy" = ${workerId},
			"startedAt" = COALESCE("startedAt", (NOW() AT TIME ZONE 'UTC')),
			"attempts" = "attempts" + 1
		WHERE "id" = (
			SELECT "id" FROM "BackgroundJob"
			WHERE "status" = 'queued' AND "expiresAt" > (NOW() AT TIME ZONE 'UTC')
			ORDER BY "createdAt" ASC
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING *;
	`;
	return rows[0] ?? null;
}

export async function runJob(job: BackgroundJob): Promise<void> {
	try {
		switch (job.type) {
			case "export_csv": {
				const payload = job.payload as { type: SheetType };
				const artifact = await buildCsvExport(job.ownerId, payload.type);
				await completeJob(job, artifact, {
					filename: artifact.filename,
					content_type: artifact.contentType,
					size: artifact.body.byteLength,
					download_url: `/api/v1/jobs/${job.id}/download`,
				});
				return;
			}
			case "export_zip": {
				const payload = job.payload as { types?: SheetType[] };
				const artifact = await buildBatchExport(job.ownerId, payload.types);
				await completeJob(job, artifact, {
					filename: artifact.filename,
					content_type: artifact.contentType,
					size: artifact.body.byteLength,
					download_url: `/api/v1/jobs/${job.id}/download`,
				});
				return;
			}
			case "export_xlsx": {
				const payload = job.payload as { types?: SheetType[] };
				const artifact = await buildXlsxExport(job.ownerId, payload.types);
				await completeJob(job, artifact, {
					filename: artifact.filename,
					content_type: artifact.contentType,
					size: artifact.body.byteLength,
					download_url: `/api/v1/jobs/${job.id}/download`,
				});
				return;
			}
			case "export_pdf": {
				const payload = (job.payload ?? {}) as { report?: PdfReport };
				const artifact =
					payload.report && payload.report !== "summary"
						? await buildReportPdf(job.ownerId, payload.report)
						: await buildPdfExport(job.ownerId);
				await completeJob(job, artifact, {
					filename: artifact.filename,
					content_type: artifact.contentType,
					size: artifact.body.byteLength,
					download_url: `/api/v1/jobs/${job.id}/download`,
				});
				return;
			}
			case "import_confirm": {
				const payload = job.payload as { type: ExportableType; csvData: string };
				const result = await confirmImport(job.ownerId, payload.type, payload.csvData);
				await completeJob(job, null, { importedCount: result.importedCount });
				return;
			}
			default:
				throw new Error(`Unknown job type: ${job.type}`);
		}
	} catch (error) {
		await failJob(job, error);
	}
}

async function completeJob(
	job: BackgroundJob,
	artifact: { filename: string; contentType: string; body: ArrayBuffer } | null,
	result: Prisma.InputJsonValue,
): Promise<void> {
	await prisma.$transaction(async (tx) => {
		await tx.backgroundJob.update({
			where: { id: job.id },
			data: {
				status: "succeeded",
				result,
				error: null,
				finishedAt: new Date(),
				lockedAt: null,
				lockedBy: null,
			},
		});

		if (artifact) {
			const data = {
				filename: artifact.filename,
				contentType: artifact.contentType,
				size: artifact.body.byteLength,
				data: Buffer.from(artifact.body),
				expiresAt: job.expiresAt,
			};
			await tx.jobArtifact.upsert({
				where: { jobId: job.id },
				create: { jobId: job.id, ...data },
				update: data,
			});
		}
	});
}

async function failJob(job: BackgroundJob, error: unknown): Promise<void> {
	// Never serialize Prisma/stack details into the status endpoint. Only an
	// explicitly exposed ApiError message is safe to show; everything else is
	// logged server-side and reported generically.
	reportError(error, { route: "jobs/worker", jobId: job.id, type: job.type });
	const message =
		error instanceof ApiError && error.expose ? error.message : "The job failed. Try again.";
	await prisma.backgroundJob.update({
		where: { id: job.id },
		data: {
			status: "failed",
			error: message.slice(0, 500),
			finishedAt: new Date(),
			lockedAt: null,
			lockedBy: null,
		},
	});
}

export async function purgeExpiredJobs(): Promise<number> {
	const deleted = await prisma.backgroundJob.deleteMany({
		where: { expiresAt: { lt: new Date() } },
	});
	return deleted.count;
}

export async function requeueStaleJobs(): Promise<number> {
	const result = await prisma.backgroundJob.updateMany({
		where: {
			status: "running",
			lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) },
		},
		data: { status: "queued", lockedAt: null, lockedBy: null },
	});
	return result.count;
}

export interface ProcessJobsResult {
	claimed: number;
	succeeded: number;
	failed: number;
	purged: number;
	requeued: number;
}

export interface JobMetrics {
	queued: number;
	running: number;
	succeeded24h: number;
	failed24h: number;
	oldestQueuedAgeMs: number | null;
	artifactBytes: number;
}

/**
 * Queue health for the admin dashboard / alerting. A dead worker shows up as a
 * growing `queued` count and an `oldestQueuedAgeMs` above the schedule interval.
 */
export async function getJobMetrics(ownerId?: string): Promise<JobMetrics> {
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
	// Tenant-scoped by default: every farm admin may read their own queue depth,
	// never the platform-wide counts (which would disclose other tenants' load).
	// A platform-wide read stays available by omitting the owner explicitly.
	const scope = ownerId ? { ownerId } : {};
	const [grouped, oldestQueued, succeeded24h, failed24h, artifacts] = await Promise.all([
		prisma.backgroundJob.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
		prisma.backgroundJob.findFirst({
			where: { status: "queued", ...scope },
			orderBy: { createdAt: "asc" },
			select: { createdAt: true },
		}),
		prisma.backgroundJob.count({
			where: { status: "succeeded", finishedAt: { gte: since }, ...scope },
		}),
		prisma.backgroundJob.count({
			where: { status: "failed", finishedAt: { gte: since }, ...scope },
		}),
		prisma.jobArtifact.aggregate({
			_sum: { size: true },
			...(ownerId ? { where: { job: { ownerId } } } : {}),
		}),
	]);

	const byStatus = new Map(grouped.map((row) => [row.status, row._count._all]));

	return {
		queued: byStatus.get("queued") ?? 0,
		running: byStatus.get("running") ?? 0,
		succeeded24h,
		failed24h,
		oldestQueuedAgeMs: oldestQueued ? Date.now() - oldestQueued.createdAt.getTime() : null,
		artifactBytes: artifacts._sum.size ?? 0,
	};
}

export async function processJobs(options: {
	workerId: string;
	max: number;
	budgetMs: number;
}): Promise<ProcessJobsResult> {
	const startedAt = Date.now();
	const purged = await purgeExpiredJobs();
	const requeued = await requeueStaleJobs();
	let claimed = 0;
	let succeeded = 0;
	let failed = 0;

	while (claimed < options.max && Date.now() - startedAt < options.budgetMs) {
		const job = await claimNextJob(options.workerId);
		if (!job) break;
		claimed += 1;
		await runJob(job);

		const after = await prisma.backgroundJob.findUnique({
			where: { id: job.id },
			select: { status: true },
		});
		if (after?.status === "succeeded") succeeded += 1;
		else failed += 1;
	}

	return { claimed, succeeded, failed, purged, requeued };
}
