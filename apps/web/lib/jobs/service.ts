import { ApiError } from "@/lib/api/errors";
import { MAX_JOB_ARTIFACT_BYTES } from "@/lib/constants";
import type { ImportableType } from "@/lib/csv";
import { scrubText } from "@/lib/error-scrub";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import type { PdfReport, SheetType } from "@/lib/xlsx/schema";
import type { BackgroundJob, Prisma } from "@prisma/client";
import { buildBatchExport, buildCsvExport, buildXlsxExport } from "./export-data";
import { confirmImport, importTransactionTimeoutMs } from "./import-data";
import { buildPdfExport } from "./pdf-export";
import { buildReportPdf } from "./report-pdf";

export const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const STALE_LOCK_MS = 5 * 60 * 1000;

/**
 * Retry policy (issue #590).
 *
 * `attempts` is incremented when a worker claims a job, so `job.attempts` is
 * the number of the attempt that is running. Five attempts with an exponential
 * backoff (30 s, 1 min, 2 min, 4 min) and a dead letter on the fifth.
 */
export const JOB_MAX_ATTEMPTS = 5;
export const JOB_BACKOFF_BASE_MS = 30 * 1000;
export const JOB_BACKOFF_MAX_MS = 15 * 60 * 1000;

export type JobType = "export_csv" | "export_zip" | "export_xlsx" | "export_pdf" | "import_confirm";
type JobStatus = "queued" | "running" | "succeeded" | "failed";

/**
 * Per-job wall-clock limit. Exports are read-only and retry safely; the import
 * writes in one transaction, so it gets the largest budget that still fits the
 * route's 15 s envelope. Anything larger must be chunked (a follow-up), not
 * run silently inside the 8 s cron budget.
 */
const JOB_TIME_LIMIT_MS = 10 * 1000;
const JOB_TIME_LIMITS_MS: Record<JobType, number> = {
	export_csv: JOB_TIME_LIMIT_MS,
	export_zip: JOB_TIME_LIMIT_MS,
	export_xlsx: JOB_TIME_LIMIT_MS,
	export_pdf: 15 * 1000,
	import_confirm: 12 * 1000,
};

class JobTimeoutError extends Error {
	readonly limitMs: number;

	constructor(limitMs: number) {
		super(`The job exceeded its ${Math.round(limitMs / 1000)} s time limit.`);
		this.name = "JobTimeoutError";
		this.limitMs = limitMs;
	}
}

/** Exponential backoff for the attempt that just failed. */
export function jobBackoffMs(attempts: number): number {
	const exponent = Math.max(0, attempts - 1);
	return Math.min(JOB_BACKOFF_BASE_MS * 2 ** exponent, JOB_BACKOFF_MAX_MS);
}

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
 *
 * The attempt cap is part of the claim predicate, not only application code:
 * a job that reached `JOB_MAX_ATTEMPTS` is never picked up again.
 *
 * Ordering is fair, not oldest-first (issue #590): a job becomes eligible at
 * `nextAttemptAt` (its backoff) or `createdAt` when it has never failed, and
 * eligible jobs are taken oldest-first. A poison job therefore cannot sit at
 * the head of the queue — its own backoff moves it behind fresh work — and a
 * retry is never starved by newer jobs either.
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
			WHERE "status" = 'queued'
				AND "expiresAt" > (NOW() AT TIME ZONE 'UTC')
				AND "attempts" < ${JOB_MAX_ATTEMPTS}
				AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= (NOW() AT TIME ZONE 'UTC'))
			ORDER BY COALESCE("nextAttemptAt", "createdAt") ASC, "createdAt" ASC
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING *;
	`;
	return rows[0] ?? null;
}

export async function runJob(
	job: BackgroundJob,
	options: { timeLimitMs?: number } = {},
): Promise<void> {
	const limitMs =
		options.timeLimitMs ?? JOB_TIME_LIMITS_MS[job.type as JobType] ?? JOB_TIME_LIMIT_MS;
	try {
		await withTimeLimit(executeJob(job, limitMs), limitMs);
	} catch (error) {
		await failJob(job, error);
	}
}

async function executeJob(job: BackgroundJob, limitMs: number): Promise<void> {
	switch (job.type) {
		case "export_csv": {
			const payload = job.payload as { type: SheetType };
			const artifact = await buildCsvExport(job.ownerId, payload.type);
			await completeJob(job, artifact, {
				filename: artifact.filename,
				content_type: artifact.contentType,
				size: artifact.body.byteLength,
				download_url: `/api/v1/jobs/${job.id}/download`,
				// #755: the artifact keeps the newest rows when the dataset is
				// larger than the export ceiling; say so in the job result.
				...(artifact.truncated ? { truncated: true } : {}),
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
				// #755: the artifact keeps the newest rows when the dataset is
				// larger than the export ceiling; say so in the job result.
				...(artifact.truncated ? { truncated: true } : {}),
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
				// #755: the artifact keeps the newest rows when the dataset is
				// larger than the export ceiling; say so in the job result.
				...(artifact.truncated ? { truncated: true } : {}),
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
				// #755: the artifact keeps the newest rows when the dataset is
				// larger than the export ceiling; say so in the job result.
				...(artifact.truncated ? { truncated: true } : {}),
			});
			return;
		}
		case "import_confirm": {
			const payload = job.payload as {
				type: ImportableType;
				csvData: string;
				pondId?: string | null;
				idempotencyKey?: string | null;
			};
			const result = await confirmImport(job.ownerId, payload.type, payload.csvData, {
				idempotencyKey: payload.idempotencyKey,
				pondId: payload.pondId,
				// #758: Prisma aborts the transaction before the job's own
				// wall-clock limit, so a timed-out job cannot commit later.
				transactionTimeoutMs: importTransactionTimeoutMs(limitMs),
			});
			await completeJob(job, null, { importedCount: result.importedCount });
			return;
		}
		default:
			throw new Error(`Unknown job type: ${job.type}`);
	}
}

/**
 * Bound one job's wall-clock time. The route has its own 15 s envelope; this
 * limit is smaller, so an overrun is recorded as a failed attempt instead of
 * the process being killed with the lock still held.
 */
async function withTimeLimit<T>(work: Promise<T>, limitMs: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new JobTimeoutError(limitMs)), limitMs);
	});
	try {
		return await Promise.race([work, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function completeJob(
	job: BackgroundJob,
	artifact: { filename: string; contentType: string; body: ArrayBuffer } | null,
	result: Prisma.InputJsonValue,
): Promise<void> {
	// #728: refuse an oversized export before it is copied into Postgres. The
	// job fails with this message instead of the function running out of memory.
	if (artifact && artifact.body.byteLength > MAX_JOB_ARTIFACT_BYTES) {
		const sizeMb = Math.ceil((artifact.body.byteLength / (1024 * 1024)) * 10) / 10;
		const limitMb = Math.floor(MAX_JOB_ARTIFACT_BYTES / (1024 * 1024));
		throw new ApiError(
			413,
			"PAYLOAD_TOO_LARGE",
			`The generated export is ${sizeMb} MB; the ${limitMb} MB artifact limit was exceeded, so it was not stored.`,
			{ expose: true },
		);
	}

	await prisma.$transaction(async (tx) => {
		// Fence the write to the attempt that still owns the lease. A timed-out
		// attempt may finish after the job was requeued or picked up again; its
		// late completion must not overwrite the newer attempt or the dead letter.
		const updated = await tx.backgroundJob.updateMany({
			where: { id: job.id, lockedBy: job.lockedBy, status: "running" },
			data: {
				status: "succeeded",
				result,
				error: null,
				lastError: null,
				finishedAt: new Date(),
				nextAttemptAt: null,
				lockedAt: null,
				lockedBy: null,
			},
		});
		if (updated.count === 0) return;

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

/** Prisma's code for an interactive transaction that expired and was rolled back. */
function isExpiredTransaction(error: unknown): boolean {
	return (
		typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2028"
	);
}

/**
 * What the user is told after a failed import.
 *
 * A 4xx never reached a commit (unknown type, foreign pond, bad row), and an
 * expired interactive transaction was rolled back by Prisma (#758). Only a
 * timeout or transport failure leaves the outcome genuinely unknown.
 */
function importFailureMessage(error: unknown, rolledBack: boolean): string {
	if (rolledBack) return "The import timed out and was rolled back. It is safe to retry.";
	if (error instanceof ApiError && error.status < 500) return error.message;
	return "The import may have been applied. Check the data before retrying.";
}

async function failJob(job: BackgroundJob, error: unknown): Promise<void> {
	// Never serialize Prisma/stack details into the status endpoint. Only an
	// explicitly exposed ApiError message is safe to show; everything else is
	// logged server-side and reported generically.
	reportError(error, { route: "jobs/worker", jobId: job.id, type: job.type });

	const attempts = Math.max(1, job.attempts);
	const timedOut = error instanceof JobTimeoutError;
	// An import owns a transaction that can commit before the job row is
	// updated, so retrying after ANY import failure can duplicate rows. A 4xx
	// ApiError and an unknown type will fail the same way again. Only transport
	// failures on read-only exports are worth another attempt.
	const permanent = error instanceof ApiError && error.status < 500;
	const unknownType = error instanceof Error && error.message.startsWith("Unknown job type:");
	const retryable = job.type !== "import_confirm" && !permanent && !unknownType;
	const terminal = !retryable || attempts >= JOB_MAX_ATTEMPTS;
	const detail = scrubText(error instanceof Error ? error.message : String(error));
	// Prisma closes (and rolls back) an interactive transaction that outlives
	// its `timeout`; it cannot have committed. The import job sizes that budget
	// below its own limit precisely so this is the failure mode (#758).
	const rolledBack = isExpiredTransaction(error);
	const message =
		job.type === "import_confirm"
			? importFailureMessage(error, rolledBack)
			: error instanceof ApiError && error.expose
				? error.message
				: "The job failed. Try again.";
	const lastError = (timedOut ? "Timed out. " : "") + detail.slice(0, 1_980);

	const updated = await prisma.backgroundJob.updateMany({
		// Fence to the attempt that still owns the lease, like completeJob.
		where: { id: job.id, lockedBy: job.lockedBy, status: "running" },
		data: terminal
			? {
					status: "failed",
					error: message.slice(0, 500),
					lastError,
					finishedAt: new Date(),
					nextAttemptAt: null,
					lockedAt: null,
					lockedBy: null,
				}
			: {
					status: "queued",
					error: null,
					lastError,
					nextAttemptAt: new Date(Date.now() + jobBackoffMs(attempts)),
					finishedAt: null,
					lockedAt: null,
					lockedBy: null,
				},
	});
	if (updated.count === 0) return;
}

export async function purgeExpiredJobs(): Promise<number> {
	const deleted = await prisma.backgroundJob.deleteMany({
		where: { expiresAt: { lt: new Date() } },
	});
	return deleted.count;
}

export async function requeueStaleJobs(): Promise<number> {
	// A crashed worker's lease is recovered, but the attempt cap and the
	// backoff apply here too (issue #590). An expired import lease is treated
	// like any import failure: the transaction may have committed, so it is
	// dead-lettered instead of retried.
	const staleBefore = new Date(Date.now() - STALE_LOCK_MS);

	const failed = await prisma.$executeRaw`
		UPDATE "BackgroundJob"
		SET
			"status" = 'failed',
			"error" = CASE
				WHEN "type" = 'import_confirm'
					THEN 'The import may have been applied. Check the data before retrying.'
				ELSE 'The job did not finish. Try again.'
			END,
			"lastError" = CASE
				WHEN "type" = 'import_confirm'
					THEN 'Worker lease expired during an import; the write may have been applied.'
				ELSE 'Worker lease expired after the final attempt.'
			END,
			"finishedAt" = (NOW() AT TIME ZONE 'UTC'),
			"nextAttemptAt" = NULL,
			"lockedAt" = NULL,
			"lockedBy" = NULL
		WHERE "status" = 'running'
			AND "lockedAt" < ${staleBefore}
			AND ("attempts" >= ${JOB_MAX_ATTEMPTS} OR "type" = 'import_confirm');
	`;

	const requeued = await prisma.$executeRaw`
		UPDATE "BackgroundJob"
		SET
			"status" = 'queued',
			"error" = NULL,
			"lastError" = 'Worker lease expired; the job was requeued.',
			"finishedAt" = NULL,
			"nextAttemptAt" = (NOW() AT TIME ZONE 'UTC') + (
				LEAST(
					POWER(2, GREATEST("attempts" - 1, 0)) * ${JOB_BACKOFF_BASE_MS},
					${JOB_BACKOFF_MAX_MS}
				) * INTERVAL '1 millisecond'
			),
			"lockedAt" = NULL,
			"lockedBy" = NULL
		WHERE "status" = 'running'
			AND "lockedAt" < ${staleBefore}
			AND "attempts" < ${JOB_MAX_ATTEMPTS}
			AND "type" <> 'import_confirm';
	`;

	return failed + requeued;
}

export interface ProcessJobsResult {
	claimed: number;
	succeeded: number;
	failed: number;
	purged: number;
	/** Stale leases handled: requeued with backoff or dead-lettered. */
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

const JOB_ROUTE_DEADLINE_MS = 15 * 1000;
const JOB_MIN_START_MS = 1000;

export async function processJobs(options: {
	workerId: string;
	max: number;
	budgetMs: number;
	/** Hard envelope this worker must stay inside (the route's own timeout). */
	deadlineMs?: number;
}): Promise<ProcessJobsResult> {
	const startedAt = Date.now();
	const deadlineMs = options.deadlineMs ?? JOB_ROUTE_DEADLINE_MS;
	const purged = await purgeExpiredJobs();
	const requeued = await requeueStaleJobs();
	let claimed = 0;
	let succeeded = 0;
	let failed = 0;

	while (claimed < options.max && Date.now() - startedAt < options.budgetMs) {
		const remaining = deadlineMs - (Date.now() - startedAt);
		// Do not claim when the route envelope leaves no room for any job.
		if (remaining <= JOB_MIN_START_MS) break;

		const job = await claimNextJob(options.workerId);
		if (!job) break;

		const typeLimit = JOB_TIME_LIMITS_MS[job.type as JobType] ?? JOB_TIME_LIMIT_MS;
		if (remaining < typeLimit + 500) {
			// A shorter limit would time out a healthy job; give the claim back
			// without spending an attempt and let the next tick run it.
			await releaseClaimedJob(job, options.workerId);
			break;
		}
		claimed += 1;

		await runJob(job, { timeLimitMs: Math.min(typeLimit, remaining - 500) });

		const after = await prisma.backgroundJob.findUnique({
			where: { id: job.id },
			select: { status: true },
		});
		if (after?.status === "succeeded") succeeded += 1;
		else failed += 1;
	}

	return { claimed, succeeded, failed, purged, requeued };
}

/** Undo a claim we decided not to run (deadline), without spending an attempt. */
async function releaseClaimedJob(job: BackgroundJob, workerId: string): Promise<void> {
	await prisma.backgroundJob.updateMany({
		where: { id: job.id, lockedBy: workerId, status: "running" },
		data: { status: "queued", lockedAt: null, lockedBy: null, attempts: { decrement: 1 } },
	});
}
