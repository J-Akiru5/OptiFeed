import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Background-job service: claim, execute, complete, fail, purge, requeue,
 * metrics and the worker loop.
 *
 * The rules under test are the ones a queue depends on: only a queued and
 * unexpired job may be claimed, an artifact is stored only when the job
 * produced one, and a failure must never leak a stack trace or Prisma detail
 * into the status endpoint.
 */

const mocks = vi.hoisted(() => {
	const update = vi.fn();
	const updateMany = vi.fn();
	const upsert = vi.fn();
	return {
		create: vi.fn(),
		findFirst: vi.fn(),
		groupBy: vi.fn(),
		count: vi.fn(),
		findUnique: vi.fn(),
		deleteMany: vi.fn(),
		updateMany,
		update,
		upsert,
		aggregate: vi.fn(),
		queryRaw: vi.fn(),
		executeRaw: vi.fn(),
		transaction: vi.fn(),
		tx: { backgroundJob: { updateMany }, jobArtifact: { upsert } },
		buildCsvExport: vi.fn(),
		buildBatchExport: vi.fn(),
		buildPdfExport: vi.fn(),
		buildReportPdf: vi.fn(),
		buildXlsxExport: vi.fn(),
		confirmImport: vi.fn(),
		reportError: vi.fn(),
	};
});

vi.mock("@/lib/prisma", () => ({
	default: {
		backgroundJob: {
			create: mocks.create,
			findFirst: mocks.findFirst,
			groupBy: mocks.groupBy,
			count: mocks.count,
			findUnique: mocks.findUnique,
			deleteMany: mocks.deleteMany,
			updateMany: mocks.updateMany,
			update: mocks.update,
		},
		jobArtifact: { aggregate: mocks.aggregate, upsert: mocks.upsert },
		$queryRaw: mocks.queryRaw,
		$executeRaw: mocks.executeRaw,
		$transaction: mocks.transaction,
	},
}));

vi.mock("@/lib/observability", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/jobs/export-data", () => ({
	buildCsvExport: mocks.buildCsvExport,
	buildBatchExport: mocks.buildBatchExport,
	buildXlsxExport: mocks.buildXlsxExport,
}));
vi.mock("@/lib/jobs/pdf-export", () => ({ buildPdfExport: mocks.buildPdfExport }));
vi.mock("@/lib/jobs/report-pdf", () => ({ buildReportPdf: mocks.buildReportPdf }));
vi.mock("@/lib/jobs/import-data", () => ({ confirmImport: mocks.confirmImport }));

import { ApiError } from "@/lib/api/errors";
import { MAX_JOB_ARTIFACT_BYTES } from "@/lib/constants";
import {
	JOB_BACKOFF_MAX_MS,
	JOB_MAX_ATTEMPTS,
	JOB_TTL_MS,
	claimNextJob,
	createJob,
	getJobMetrics,
	jobBackoffMs,
	jobDto,
	processJobs,
	purgeExpiredJobs,
	requeueStaleJobs,
	runJob,
} from "@/lib/jobs/service";
import type { BackgroundJob } from "@prisma/client";

const JOB = {
	id: "job_1",
	ownerId: "farm-a",
	requestedBy: "sb-1",
	type: "export_csv",
	status: "running",
	payload: { type: "feed_events" },
	result: null,
	error: null,
	attempts: 1,
	lockedAt: new Date("2026-10-22T00:00:00Z"),
	lockedBy: "worker-1",
	createdAt: new Date("2026-10-22T00:00:00Z"),
	startedAt: new Date("2026-10-22T00:00:00Z"),
	finishedAt: null,
	expiresAt: new Date("2026-10-23T00:00:00Z"),
} as unknown as BackgroundJob;

const BODY = new TextEncoder().encode("a,b\n1,2\n").buffer;
const ARTIFACT = { filename: "feed-events.csv", contentType: "text/csv", body: BODY };

beforeEach(() => {
	// `reset` rather than `clear`: a `mockResolvedValueOnce` that a test never
	// consumed must not leak into the next one.
	vi.resetAllMocks();
	mocks.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) =>
		run(mocks.tx),
	);
	mocks.updateMany.mockResolvedValue(JOB);
	mocks.upsert.mockResolvedValue({});
	mocks.buildCsvExport.mockResolvedValue(ARTIFACT);
	mocks.buildBatchExport.mockResolvedValue(ARTIFACT);
	mocks.buildPdfExport.mockResolvedValue(ARTIFACT);
	mocks.buildReportPdf.mockResolvedValue(ARTIFACT);
	mocks.buildXlsxExport.mockResolvedValue(ARTIFACT);
	mocks.confirmImport.mockResolvedValue({ importedCount: 7 });
	mocks.deleteMany.mockResolvedValue({ count: 3 });
	mocks.updateMany.mockResolvedValue({ count: 1 });
	mocks.executeRaw.mockResolvedValue(1);
	mocks.queryRaw.mockResolvedValue([]);
	mocks.findUnique.mockResolvedValue({ status: "succeeded" });
});

describe("createJob", () => {
	it("defaults to a 24-hour lifetime and no requester", async () => {
		mocks.create.mockResolvedValue(JOB);
		const before = Date.now();

		await createJob({ ownerId: "farm-a", type: "export_csv", payload: { type: "feed_events" } });

		const data = mocks.create.mock.calls[0]?.[0].data as {
			requestedBy: string | null;
			expiresAt: Date;
		};
		expect(data.requestedBy).toBeNull();
		expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + JOB_TTL_MS);
		expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + JOB_TTL_MS);
	});

	it("honours an explicit lifetime and requester", async () => {
		mocks.create.mockResolvedValue(JOB);
		const before = Date.now();

		await createJob({
			ownerId: "farm-a",
			requestedBy: "sb-1",
			type: "export_pdf",
			payload: {},
			ttlMs: 60_000,
		});

		const data = mocks.create.mock.calls[0]?.[0].data as {
			requestedBy: string | null;
			expiresAt: Date;
		};
		expect(data.requestedBy).toBe("sb-1");
		expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
		expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
	});
});

describe("jobDto", () => {
	it("leaves the download URL empty for a succeeded job without an artifact", () => {
		const dto = jobDto({ ...JOB, status: "succeeded", artifact: null } as never);

		expect(dto.download_url).toBeNull();
		expect(dto.status_url).toBe("/api/v1/jobs/job_1");
	});

	it("serialises timestamps and passes the stored result through", () => {
		const dto = jobDto({
			...JOB,
			status: "succeeded",
			finishedAt: new Date("2026-10-22T00:02:00Z"),
			result: { importedCount: 7 },
		} as never);

		expect(dto.started_at).toBe("2026-10-22T00:00:00.000Z");
		expect(dto.finished_at).toBe("2026-10-22T00:02:00.000Z");
		expect(dto.result).toEqual({ importedCount: 7 });
	});

	it("reports null for a job that has not started", () => {
		const dto = jobDto({ ...JOB, status: "queued", startedAt: null } as never);

		expect(dto.started_at).toBeNull();
		expect(dto.finished_at).toBeNull();
	});
});

describe("claimNextJob", () => {
	it("returns null when no queued job is available", async () => {
		mocks.queryRaw.mockResolvedValue([]);

		await expect(claimNextJob("worker-1")).resolves.toBeNull();
	});

	it("returns the claimed row and stamps the worker id", async () => {
		mocks.queryRaw.mockResolvedValue([JOB]);

		const claimed = await claimNextJob("worker-1");

		expect(claimed).toBe(JOB);
		expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
		// The interpolations are the worker id and the attempt cap.
		expect(mocks.queryRaw.mock.calls[0]?.slice(1)).toEqual(["worker-1", JOB_MAX_ATTEMPTS]);
	});

	it("only claims queued, ready, unexpired jobs below the attempt cap, fairest first", async () => {
		mocks.queryRaw.mockResolvedValue([JOB]);

		await claimNextJob("worker-1");

		const sql = (mocks.queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join("?");
		expect(sql).toContain(`WHERE "status" = 'queued'`);
		expect(sql).toContain(`"expiresAt" > (NOW() AT TIME ZONE 'UTC')`);
		expect(sql).toContain(`"attempts" < ?`);
		expect(sql).toContain(
			`"nextAttemptAt" IS NULL OR "nextAttemptAt" <= (NOW() AT TIME ZONE 'UTC')`,
		);
		expect(sql).toContain(`ORDER BY COALESCE("nextAttemptAt", "createdAt") ASC, "createdAt" ASC`);
		expect(sql).toContain("FOR UPDATE SKIP LOCKED");
	});
});

describe("runJob exports", () => {
	it("stores the CSV artifact and marks the job succeeded", async () => {
		await runJob(JOB);

		expect(mocks.buildCsvExport).toHaveBeenCalledWith("farm-a", "feed_events");
		expect(mocks.updateMany).toHaveBeenCalledWith({
			where: { id: "job_1", lockedBy: "worker-1", status: "running" },
			data: {
				status: "succeeded",
				result: {
					filename: "feed-events.csv",
					content_type: "text/csv",
					size: BODY.byteLength,
					download_url: "/api/v1/jobs/job_1/download",
				},
				error: null,
				lastError: null,
				finishedAt: expect.any(Date),
				nextAttemptAt: null,
				lockedAt: null,
				lockedBy: null,
			},
		});

		const artifactData = {
			filename: "feed-events.csv",
			contentType: "text/csv",
			size: BODY.byteLength,
			data: Buffer.from(BODY),
			expiresAt: JOB.expiresAt,
		};
		expect(mocks.upsert).toHaveBeenCalledWith({
			where: { jobId: "job_1" },
			create: { jobId: "job_1", ...artifactData },
			update: artifactData,
		});
	});

	it("fails an oversized artifact before storing it, with a readable message", async () => {
		mocks.buildCsvExport.mockResolvedValue({
			...ARTIFACT,
			body: { byteLength: MAX_JOB_ARTIFACT_BYTES + 1 } as ArrayBuffer,
		});

		await runJob(JOB);

		expect(mocks.transaction).not.toHaveBeenCalled();
		expect(mocks.upsert).not.toHaveBeenCalled();
		const data = mocks.updateMany.mock.calls[0]?.[0].data as {
			status: string;
			error: string;
		};
		expect(data.status).toBe("failed");
		expect(data.error).toContain("25 MB");
		expect(data.error).toContain("exceeded");
	});

	it("passes the requested types to the ZIP builder", async () => {
		await runJob({
			...JOB,
			type: "export_zip",
			payload: { types: ["feed_events", "ponds"] },
		} as unknown as BackgroundJob);

		expect(mocks.buildBatchExport).toHaveBeenCalledWith("farm-a", ["feed_events", "ponds"]);
	});

	it("builds a PDF for the job owner", async () => {
		await runJob({ ...JOB, type: "export_pdf", payload: {} } as unknown as BackgroundJob);

		expect(mocks.buildPdfExport).toHaveBeenCalledWith("farm-a");
		expect(mocks.buildReportPdf).not.toHaveBeenCalled();
	});

	it("builds the summary PDF when the payload names the summary report", async () => {
		await runJob({
			...JOB,
			type: "export_pdf",
			payload: { report: "summary" },
		} as unknown as BackgroundJob);

		expect(mocks.buildPdfExport).toHaveBeenCalledWith("farm-a");
		expect(mocks.buildReportPdf).not.toHaveBeenCalled();
	});

	it("builds a growth, SGR or FCR report PDF", async () => {
		await runJob({
			...JOB,
			type: "export_pdf",
			payload: { report: "sgr" },
		} as unknown as BackgroundJob);

		expect(mocks.buildReportPdf).toHaveBeenCalledWith("farm-a", "sgr");
		expect(mocks.buildPdfExport).not.toHaveBeenCalled();
	});

	it("passes the requested sheet types to the workbook builder", async () => {
		await runJob({
			...JOB,
			type: "export_xlsx",
			payload: { types: ["biomass_logs", "feeding_schedule"] },
		} as unknown as BackgroundJob);

		expect(mocks.buildXlsxExport).toHaveBeenCalledWith("farm-a", [
			"biomass_logs",
			"feeding_schedule",
		]);
		expect(mocks.upsert).toHaveBeenCalled();
	});
});

describe("runJob imports", () => {
	it("stores the imported count and writes no artifact", async () => {
		await runJob({
			...JOB,
			type: "import_confirm",
			payload: { type: "feed_events", csvData: "a,b\n1,2\n" },
		} as unknown as BackgroundJob);

		expect(mocks.confirmImport).toHaveBeenCalledWith("farm-a", "feed_events", "a,b\n1,2\n", {
			idempotencyKey: undefined,
		});
		expect(mocks.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "succeeded",
					result: { importedCount: 7 },
				}),
			}),
		);
		expect(mocks.upsert).not.toHaveBeenCalled();
	});

	it("passes the queued idempotency key to the importer", async () => {
		await runJob({
			...JOB,
			type: "import_confirm",
			payload: { type: "feed_events", csvData: "a,b\n1,2\n", idempotencyKey: "job-key-1" },
		} as unknown as BackgroundJob);

		expect(mocks.confirmImport).toHaveBeenCalledWith("farm-a", "feed_events", "a,b\n1,2\n", {
			idempotencyKey: "job-key-1",
		});
	});
});

describe("runJob failures", () => {
	it("dead-letters an unknown job type on the first attempt", async () => {
		await runJob({ ...JOB, type: "export_docx", attempts: 1 } as unknown as BackgroundJob);

		expect(mocks.reportError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "Unknown job type: export_docx" }),
			{ route: "jobs/worker", jobId: "job_1", type: "export_docx" },
		);
		expect(mocks.updateMany).toHaveBeenCalledWith({
			where: { id: "job_1", lockedBy: "worker-1", status: "running" },
			data: {
				status: "failed",
				error: "The job failed. Try again.",
				lastError: "Unknown job type: export_docx",
				finishedAt: expect.any(Date),
				nextAttemptAt: null,
				lockedAt: null,
				lockedBy: null,
			},
		});
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("dead-letters the final attempt of a transient failure", async () => {
		mocks.buildCsvExport.mockRejectedValue(new Error("connection reset"));

		await runJob({ ...JOB, attempts: JOB_MAX_ATTEMPTS });

		expect(mocks.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "job_1", lockedBy: "worker-1", status: "running" },
				data: expect.objectContaining({
					status: "failed",
					error: "The job failed. Try again.",
					lastError: "connection reset",
					finishedAt: expect.any(Date),
					nextAttemptAt: null,
				}),
			}),
		);
	});

	it("shows an explicitly exposed ApiError message on the terminal attempt", async () => {
		mocks.buildCsvExport.mockRejectedValue(
			new ApiError(400, "BAD_REQUEST", "There is nothing to export yet."),
		);

		await runJob({ ...JOB, attempts: JOB_MAX_ATTEMPTS });

		expect(mocks.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "failed",
					error: "There is nothing to export yet.",
					lastError: "There is nothing to export yet.",
				}),
			}),
		);
	});

	it("hides a 5xx ApiError behind the generic message on the terminal attempt", async () => {
		mocks.buildCsvExport.mockRejectedValue(
			new ApiError(500, "INTERNAL_ERROR", 'relation "Pond" does not exist'),
		);

		await runJob({ ...JOB, attempts: JOB_MAX_ATTEMPTS });

		expect(mocks.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					error: "The job failed. Try again.",
					lastError: 'relation "Pond" does not exist',
				}),
			}),
		);
	});

	it("truncates a long exposed message to 500 characters", async () => {
		mocks.buildCsvExport.mockRejectedValue(new ApiError(400, "BAD_REQUEST", "x".repeat(600)));

		await runJob({ ...JOB, attempts: JOB_MAX_ATTEMPTS });

		const data = mocks.updateMany.mock.calls[0]?.[0].data as { error: string };
		expect(data.error).toHaveLength(500);
	});

	it("dead-letters a 4xx on the first attempt instead of retrying it", async () => {
		mocks.buildCsvExport.mockRejectedValue(
			new ApiError(400, "BAD_REQUEST", "There is nothing to export yet."),
		);

		await runJob({ ...JOB, attempts: 1 });

		const data = mocks.updateMany.mock.calls[0]?.[0].data as {
			status: string;
			error: string;
		};
		expect(data.status).toBe("failed");
		expect(data.error).toBe("There is nothing to export yet.");
	});

	it("retries when the completion transaction rejects", async () => {
		mocks.transaction.mockRejectedValueOnce(new Error("connection reset"));

		await runJob({ ...JOB, attempts: 1 });

		expect(mocks.reportError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "connection reset" }),
			{ route: "jobs/worker", jobId: "job_1", type: "export_csv" },
		);
		expect(mocks.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ status: "queued", lastError: "connection reset" }),
			}),
		);
	});
});

describe("maintenance", () => {
	it("purges only jobs whose expiry has passed", async () => {
		const before = Date.now();

		const deleted = await purgeExpiredJobs();

		expect(deleted).toBe(3);
		const where = mocks.deleteMany.mock.calls[0]?.[0].where as {
			expiresAt: { lt: Date };
		};
		expect(where.expiresAt.lt.getTime()).toBeGreaterThanOrEqual(before);
		expect(where.expiresAt.lt.getTime()).toBeLessThanOrEqual(Date.now());
	});

	it("dead-letters exhausted and import leases, and backs off the rest", async () => {
		mocks.executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
		const before = Date.now() - 5 * 60 * 1000;

		const requeued = await requeueStaleJobs();

		expect(requeued).toBe(2);
		expect(mocks.executeRaw).toHaveBeenCalledTimes(2);

		const failedSql = (mocks.executeRaw.mock.calls[0]?.[0] as TemplateStringsArray).join("?");
		expect(failedSql).toContain(`"status" = 'failed'`);
		expect(failedSql).toContain(`"attempts" >= ? OR "type" = 'import_confirm'`);

		const requeueSql = (mocks.executeRaw.mock.calls[1]?.[0] as TemplateStringsArray).join("?");
		expect(requeueSql).toContain(`"status" = 'queued'`);
		expect(requeueSql).toContain(`"nextAttemptAt"`);
		expect(requeueSql).toContain(`POWER(2, GREATEST("attempts" - 1, 0))`);
		expect(requeueSql).toContain(`"type" <> 'import_confirm'`);

		const params = mocks.executeRaw.mock.calls[1]?.slice(1) as unknown[];
		expect(params).toContain(JOB_MAX_ATTEMPTS);
		const cutoff = params.find((value) => value instanceof Date) as Date;
		expect(cutoff).toBeInstanceOf(Date);
		expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 1_000);
		expect(cutoff.getTime()).toBeLessThanOrEqual(before + 1_000);
	});
});

describe("retry policy", () => {
	it("backs off exponentially up to the cap", () => {
		expect(jobBackoffMs(1)).toBe(30_000);
		expect(jobBackoffMs(2)).toBe(60_000);
		expect(jobBackoffMs(3)).toBe(120_000);
		expect(jobBackoffMs(4)).toBe(240_000);
		expect(jobBackoffMs(30)).toBe(JOB_BACKOFF_MAX_MS);
	});

	it("requeues a failure below the cap with the next attempt scheduled", async () => {
		mocks.buildCsvExport.mockRejectedValue(new Error("boom"));

		await runJob({ ...JOB, attempts: 2 });

		const data = mocks.updateMany.mock.calls[0]?.[0].data as {
			status: string;
			error: string | null;
			lastError: string;
			nextAttemptAt: Date;
		};
		expect(data.status).toBe("queued");
		expect(data.error).toBeNull();
		expect(data.lastError).toBe("boom");
		const delay = data.nextAttemptAt.getTime() - Date.now();
		expect(delay).toBeGreaterThan(55_000);
		expect(delay).toBeLessThanOrEqual(60_000);
	});

	it("does not retry an import failure, because the write may have committed", async () => {
		mocks.confirmImport.mockRejectedValue(new Error("connection reset"));

		await runJob({
			...JOB,
			type: "import_confirm",
			payload: { type: "feed_events", csvData: "a,b\n1,2\n" },
			attempts: 1,
		} as unknown as BackgroundJob);

		const data = mocks.updateMany.mock.calls[0]?.[0].data as {
			status: string;
			error: string;
		};
		expect(data.status).toBe("failed");
		expect(data.error).toBe("The import may have been applied. Check the data before retrying.");
	});
});

describe("per-job time limit", () => {
	it("records an export timeout as a retryable failure instead of hanging", async () => {
		mocks.buildCsvExport.mockImplementation(() => new Promise(() => undefined));

		await runJob(JOB, { timeLimitMs: 5 });

		const data = mocks.updateMany.mock.calls[0]?.[0].data as {
			status: string;
			lastError: string;
		};
		expect(data.status).toBe("queued");
		expect(data.lastError).toContain("Timed out.");
	});

	it("dead-letters an import timeout because the write may have committed", async () => {
		mocks.confirmImport.mockImplementation(() => new Promise(() => undefined));

		await runJob(
			{
				...JOB,
				type: "import_confirm",
				payload: { type: "feed_events", csvData: "a,b\n1,2\n" },
			} as unknown as BackgroundJob,
			{ timeLimitMs: 5 },
		);

		const data = mocks.updateMany.mock.calls[0]?.[0].data as {
			status: string;
			lastError: string;
			nextAttemptAt: null;
		};
		expect(data.status).toBe("failed");
		expect(data.lastError).toContain("Timed out.");
		expect(data.nextAttemptAt).toBeNull();
	});
});

describe("poison job", () => {
	it("reaches failed after maxAttempts and lets a healthy job behind it run", async () => {
		const poisonRows = [1, 2, 3, 4, 5].map((attempt) => ({
			...JOB,
			id: "poison",
			attempts: attempt,
		}));
		const healthy = { ...JOB, id: "healthy", attempts: 1 };
		const queue = [...poisonRows, healthy];
		const status = new Map<string, string>();
		let next = 0;

		mocks.queryRaw.mockImplementation(() => {
			const row = queue[next++];
			return Promise.resolve(row ? [row] : []);
		});
		mocks.updateMany.mockImplementation(
			async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
				status.set(where.id, data.status);
				return { count: 1 };
			},
		);
		mocks.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
			status: status.get(where.id) ?? "queued",
		}));
		let executions = 0;
		mocks.buildCsvExport.mockImplementation(async () => {
			executions += 1;
			if (executions <= JOB_MAX_ATTEMPTS) throw new Error("poison payload");
			return ARTIFACT;
		});

		const result = await processJobs({ workerId: "worker-1", max: 10, budgetMs: 60_000 });

		expect(result.claimed).toBe(6);
		expect(result.succeeded).toBe(1);
		expect(result.failed).toBe(5);
		expect(executions).toBe(6);
		expect(status.get("poison")).toBe("failed");
		expect(status.get("healthy")).toBe("succeeded");
	});
});

describe("getJobMetrics totals", () => {
	it("reports zero for statuses that have no rows", async () => {
		mocks.groupBy.mockResolvedValue([{ status: "failed", _count: { _all: 1 } }]);
		mocks.findFirst.mockResolvedValue(null);
		mocks.count.mockResolvedValue(0);
		mocks.aggregate.mockResolvedValue({ _sum: { size: null } });

		const metrics = await getJobMetrics();

		expect(metrics).toEqual({
			queued: 0,
			running: 0,
			succeeded24h: 0,
			failed24h: 0,
			// No queued row means no age to report.
			oldestQueuedAgeMs: null,
			artifactBytes: 0,
		});
	});
});

describe("processJobs", () => {
	it("purges, requeues and drains at most the requested batch", async () => {
		mocks.queryRaw
			.mockResolvedValueOnce([{ ...JOB, id: "job_1" }])
			.mockResolvedValueOnce([{ ...JOB, id: "job_2" }]);

		const result = await processJobs({ workerId: "worker-1", max: 2, budgetMs: 60_000 });

		expect(result).toEqual({
			claimed: 2,
			succeeded: 2,
			failed: 0,
			purged: 3,
			requeued: 2,
		});
		// The loop stops at `max` instead of asking for a third job.
		expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
	});

	it("stops at max even when more rows are queued", async () => {
		mocks.queryRaw.mockResolvedValue([{ ...JOB, id: "job_1" }]);

		const result = await processJobs({ workerId: "worker-1", max: 1, budgetMs: 60_000 });

		expect(result.claimed).toBe(1);
		expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
	});

	it("stops when the queue is empty", async () => {
		mocks.queryRaw.mockResolvedValue([]);

		const result = await processJobs({ workerId: "worker-1", max: 5, budgetMs: 60_000 });

		expect(result).toMatchObject({ claimed: 0, succeeded: 0, failed: 0 });
		expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
	});

	it("counts a job the worker marked failed as failed", async () => {
		mocks.queryRaw.mockResolvedValueOnce([{ ...JOB, id: "job_1" }]).mockResolvedValueOnce([]);
		mocks.findUnique.mockResolvedValue({ status: "failed" });

		const result = await processJobs({ workerId: "worker-1", max: 5, budgetMs: 60_000 });

		expect(result).toMatchObject({ claimed: 1, succeeded: 0, failed: 1 });
	});

	it("counts a vanished job row as failed rather than succeeding", async () => {
		mocks.queryRaw.mockResolvedValueOnce([{ ...JOB, id: "job_1" }]).mockResolvedValueOnce([]);
		mocks.findUnique.mockResolvedValue(null);

		const result = await processJobs({ workerId: "worker-1", max: 5, budgetMs: 60_000 });

		expect(result).toMatchObject({ claimed: 1, succeeded: 0, failed: 1 });
	});

	it("does no work when the time budget is already spent", async () => {
		const result = await processJobs({ workerId: "worker-1", max: 5, budgetMs: 0 });

		expect(result).toMatchObject({ claimed: 0, succeeded: 0, failed: 0 });
		// Maintenance still runs before the budget is checked.
		expect(mocks.deleteMany).toHaveBeenCalledTimes(1);
		expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
		expect(mocks.queryRaw).not.toHaveBeenCalled();
	});

	it("gives a claim back instead of starting a job past the deadline", async () => {
		mocks.queryRaw.mockResolvedValueOnce([{ ...JOB, id: "job_1" }]);

		const result = await processJobs({
			workerId: "worker-1",
			max: 5,
			budgetMs: 60_000,
			deadlineMs: 5_000,
		});

		expect(result.claimed).toBe(0);
		expect(mocks.buildCsvExport).not.toHaveBeenCalled();
		expect(mocks.updateMany).toHaveBeenCalledWith({
			where: { id: "job_1", lockedBy: "worker-1", status: "running" },
			data: { status: "queued", lockedAt: null, lockedBy: null, attempts: { decrement: 1 } },
		});
	});
});
