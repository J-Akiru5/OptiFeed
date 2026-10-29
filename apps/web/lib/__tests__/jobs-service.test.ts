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
	const upsert = vi.fn();
	return {
		create: vi.fn(),
		findFirst: vi.fn(),
		groupBy: vi.fn(),
		count: vi.fn(),
		findUnique: vi.fn(),
		deleteMany: vi.fn(),
		updateMany: vi.fn(),
		update,
		upsert,
		aggregate: vi.fn(),
		queryRaw: vi.fn(),
		transaction: vi.fn(),
		tx: { backgroundJob: { update }, jobArtifact: { upsert } },
		buildCsvExport: vi.fn(),
		buildBatchExport: vi.fn(),
		buildPdfExport: vi.fn(),
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
		$transaction: mocks.transaction,
	},
}));

vi.mock("@/lib/observability", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/jobs/export-data", () => ({
	buildCsvExport: mocks.buildCsvExport,
	buildBatchExport: mocks.buildBatchExport,
}));
vi.mock("@/lib/jobs/pdf-export", () => ({ buildPdfExport: mocks.buildPdfExport }));
vi.mock("@/lib/jobs/import-data", () => ({ confirmImport: mocks.confirmImport }));

import { ApiError } from "@/lib/api/errors";
import {
	JOB_TTL_MS,
	claimNextJob,
	createJob,
	getJobMetrics,
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
	mocks.update.mockResolvedValue(JOB);
	mocks.upsert.mockResolvedValue({});
	mocks.buildCsvExport.mockResolvedValue(ARTIFACT);
	mocks.buildBatchExport.mockResolvedValue(ARTIFACT);
	mocks.buildPdfExport.mockResolvedValue(ARTIFACT);
	mocks.confirmImport.mockResolvedValue({ importedCount: 7 });
	mocks.deleteMany.mockResolvedValue({ count: 3 });
	mocks.updateMany.mockResolvedValue({ count: 1 });
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
		// The only interpolation is the worker id; the SQL itself is static.
		expect(mocks.queryRaw.mock.calls[0]?.slice(1)).toEqual(["worker-1"]);
	});

	it("only considers queued, unexpired jobs, oldest first", async () => {
		mocks.queryRaw.mockResolvedValue([JOB]);

		await claimNextJob("worker-1");

		const sql = (mocks.queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join("?");
		expect(sql).toContain(`WHERE "status" = 'queued'`);
		expect(sql).toContain(`"expiresAt" > (NOW() AT TIME ZONE 'UTC')`);
		expect(sql).toContain(`ORDER BY "createdAt" ASC`);
		expect(sql).toContain("FOR UPDATE SKIP LOCKED");
	});
});

describe("runJob exports", () => {
	it("stores the CSV artifact and marks the job succeeded", async () => {
		await runJob(JOB);

		expect(mocks.buildCsvExport).toHaveBeenCalledWith("farm-a", "feed_events");
		expect(mocks.update).toHaveBeenCalledWith({
			where: { id: "job_1" },
			data: {
				status: "succeeded",
				result: {
					filename: "feed-events.csv",
					content_type: "text/csv",
					size: BODY.byteLength,
					download_url: "/api/v1/jobs/job_1/download",
				},
				error: null,
				finishedAt: expect.any(Date),
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
	});
});

describe("runJob imports", () => {
	it("stores the imported count and writes no artifact", async () => {
		await runJob({
			...JOB,
			type: "import_confirm",
			payload: { type: "feed_events", csvData: "a,b\n1,2\n" },
		} as unknown as BackgroundJob);

		expect(mocks.confirmImport).toHaveBeenCalledWith("farm-a", "feed_events", "a,b\n1,2\n");
		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "succeeded",
					result: { importedCount: 7 },
				}),
			}),
		);
		expect(mocks.upsert).not.toHaveBeenCalled();
	});
});

describe("runJob failures", () => {
	it("fails an unknown job type without a generic stack", async () => {
		await runJob({ ...JOB, type: "export_xlsx" } as unknown as BackgroundJob);

		expect(mocks.reportError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "Unknown job type: export_xlsx" }),
			{ route: "jobs/worker", jobId: "job_1", type: "export_xlsx" },
		);
		expect(mocks.update).toHaveBeenCalledWith({
			where: { id: "job_1" },
			data: {
				status: "failed",
				error: "The job failed. Try again.",
				finishedAt: expect.any(Date),
				lockedAt: null,
				lockedBy: null,
			},
		});
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("shows an explicitly exposed ApiError message", async () => {
		mocks.buildCsvExport.mockRejectedValue(
			new ApiError(400, "BAD_REQUEST", "There is nothing to export yet."),
		);

		await runJob(JOB);

		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "failed",
					error: "There is nothing to export yet.",
				}),
			}),
		);
	});

	it("hides a 5xx ApiError behind the generic message", async () => {
		mocks.buildCsvExport.mockRejectedValue(
			new ApiError(500, "INTERNAL_ERROR", 'relation "Pond" does not exist'),
		);

		await runJob(JOB);

		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ error: "The job failed. Try again." }),
			}),
		);
	});

	it("truncates a long exposed message to 500 characters", async () => {
		mocks.buildCsvExport.mockRejectedValue(new ApiError(400, "BAD_REQUEST", "x".repeat(600)));

		await runJob(JOB);

		const data = mocks.update.mock.calls[0]?.[0].data as { error: string };
		expect(data.error).toHaveLength(500);
	});

	it("fails the job when the completion transaction rejects", async () => {
		mocks.transaction.mockRejectedValueOnce(new Error("connection reset"));

		await runJob(JOB);

		expect(mocks.reportError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "connection reset" }),
			{ route: "jobs/worker", jobId: "job_1", type: "export_csv" },
		);
		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ status: "failed" }),
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

	it("requeues jobs whose worker lease is older than five minutes", async () => {
		const before = Date.now() - 5 * 60 * 1000;

		const requeued = await requeueStaleJobs();

		expect(requeued).toBe(1);
		const args = mocks.updateMany.mock.calls[0]?.[0] as unknown as {
			where: { status: string; lockedAt: { lt: Date } };
			data: { status: string; lockedAt: null; lockedBy: null };
		};
		expect(args.where.status).toBe("running");
		expect(args.where.lockedAt.lt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
		expect(args.where.lockedAt.lt.getTime()).toBeLessThanOrEqual(before + 1_000);
		expect(args.data).toEqual({ status: "queued", lockedAt: null, lockedBy: null });
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
			requeued: 1,
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
		expect(mocks.updateMany).toHaveBeenCalledTimes(1);
		expect(mocks.queryRaw).not.toHaveBeenCalled();
	});
});
