import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	findFirst: vi.fn(),
	groupBy: vi.fn(),
	count: vi.fn(),
	aggregate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		backgroundJob: {
			findFirst: state.findFirst,
			groupBy: state.groupBy,
			count: state.count,
		},
		jobArtifact: { aggregate: state.aggregate },
	},
}));

import { getJobForOwner, getJobMetrics, jobDto } from "@/lib/jobs/service";

const BASE_JOB = {
	id: "job_1",
	ownerId: "farm-a",
	requestedBy: "sb-1",
	type: "export_csv",
	status: "queued",
	payload: { type: "feed_events" },
	result: null,
	error: null,
	attempts: 0,
	lockedAt: null,
	lockedBy: null,
	createdAt: new Date("2026-10-22T00:00:00Z"),
	startedAt: null,
	finishedAt: null,
	expiresAt: new Date("2026-10-23T00:00:00Z"),
};

describe("job DTO", () => {
	it("has no download URL before the job succeeds", () => {
		expect(jobDto(BASE_JOB as never)).toMatchObject({
			id: "job_1",
			status: "queued",
			status_url: "/api/v1/jobs/job_1",
			download_url: null,
		});
	});

	it("exposes a download URL only for a succeeded job with an artifact", () => {
		const dto = jobDto({
			...BASE_JOB,
			status: "succeeded",
			finishedAt: new Date("2026-10-22T00:01:00Z"),
			artifact: { filename: "feed.csv", contentType: "text/csv", size: 10 },
		} as never);

		expect(dto.download_url).toBe("/api/v1/jobs/job_1/download");
		expect(dto.finished_at).toBe("2026-10-22T00:01:00.000Z");
	});
});

describe("job ownership", () => {
	beforeEach(() => {
		state.findFirst.mockReset();
	});

	it("scopes the lookup to the owner and the job id", async () => {
		state.findFirst.mockResolvedValue(null);
		await getJobForOwner("farm-a", "job_1");

		expect(state.findFirst).toHaveBeenCalledWith({
			where: { id: "job_1", ownerId: "farm-a" },
			include: { artifact: { select: { filename: true, contentType: true, size: true } } },
		});
	});
});

describe("queue metrics", () => {
	beforeEach(() => {
		state.findFirst.mockReset();
		state.groupBy.mockReset();
		state.count.mockReset();
		state.aggregate.mockReset();
	});

	it("reports depth, oldest queued age, failures and artifact bytes", async () => {
		state.groupBy.mockResolvedValue([
			{ status: "queued", _count: { _all: 2 } },
			{ status: "running", _count: { _all: 1 } },
		]);
		state.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 120_000) });
		state.count.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
		state.aggregate.mockResolvedValue({ _sum: { size: 1234 } });

		const metrics = await getJobMetrics();

		expect(metrics).toMatchObject({
			queued: 2,
			running: 1,
			succeeded24h: 5,
			failed24h: 1,
			artifactBytes: 1234,
		});
		expect(metrics.oldestQueuedAgeMs).toBeGreaterThanOrEqual(119_000);
	});
});
