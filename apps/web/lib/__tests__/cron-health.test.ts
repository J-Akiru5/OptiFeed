import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, findUnique, upsert } = vi.hoisted(() => ({
	findMany: vi.fn(),
	findUnique: vi.fn(),
	upsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: { cronHeartbeat: { findMany, findUnique, upsert } },
}));

import {
	type CronHealth,
	type CronHealthRow,
	cronAlertForJob,
	readCronHealth,
	recordCronHeartbeat,
} from "@/lib/ops/cron-heartbeat";
import { CRON_JOBS, RUNNING_HEARTBEAT_MARGIN_MS } from "@/lib/ops/cron-jobs";

const NOW = new Date("2026-11-04T12:00:00.000Z");

interface HeartbeatFixture {
	name: string;
	lastRunAt: Date;
	lastStatus: string;
	lastError: string | null;
}

function freshRows(now = NOW): HeartbeatFixture[] {
	return CRON_JOBS.map((job) => ({
		name: job.name,
		lastRunAt: new Date(now.getTime() - 60_000),
		lastStatus: "ok",
		lastError: null,
	}));
}

function overrideJob<T extends { name: string }>(
	rows: T[],
	name: string,
	overrides: Partial<T>,
): T[] {
	return rows.map((row) => (row.name === name ? { ...row, ...overrides } : row));
}

function jobFrom(health: CronHealth, name: string): CronHealthRow {
	const found = health.jobs.find((job) => job.name === name);
	if (!found) throw new Error(`missing job ${name}`);
	return found;
}

beforeEach(() => {
	vi.clearAllMocks();
	findMany.mockResolvedValue([]);
	findUnique.mockResolvedValue(null);
	upsert.mockResolvedValue({});
});

describe("readCronHealth (#725, #729)", () => {
	it("reports never-run for every known cron when no heartbeat exists", async () => {
		const health = await readCronHealth(NOW);

		expect(health.status).toBe("stale");
		expect(health.jobs.map((job) => job.name)).toEqual([
			"device-watch",
			"background-jobs",
			"crop-watch",
			"heartbeat-watch",
		]);
		expect(health.jobs.every((job) => job.state === "never-run")).toBe(true);
		expect(health.jobs.every((job) => job.stale)).toBe(true);
	});

	it("reports ok when every heartbeat is fresh", async () => {
		findMany.mockResolvedValue(freshRows());

		const health = await readCronHealth(NOW);

		expect(health.status).toBe("ok");
		expect(health.jobs.every((job) => job.state === "ok")).toBe(true);
		expect(health.jobs.every((job) => !job.stale)).toBe(true);
	});

	it("marks a fresh heartbeat error when its last run failed", async () => {
		findMany.mockResolvedValue(
			overrideJob(freshRows(), "device-watch", {
				lastStatus: "error",
				lastError: "boom",
			}),
		);

		const health = await readCronHealth(NOW);
		const deviceWatch = jobFrom(health, "device-watch");

		expect(deviceWatch).toMatchObject({
			state: "error",
			stale: true,
			lastStatus: "error",
			lastError: "boom",
		});
	});

	it("marks a heartbeat older than its schedule stale", async () => {
		findMany.mockResolvedValue(
			overrideJob(freshRows(), "background-jobs", {
				lastRunAt: new Date(NOW.getTime() - 20 * 60_000),
			}),
		);

		const health = await readCronHealth(NOW);

		expect(jobFrom(health, "background-jobs")).toMatchObject({
			state: "stale",
			stale: true,
		});
	});

	it("treats a running marker at the budget plus margin as still in flight", async () => {
		const cropWatch = CRON_JOBS.find((job) => job.name === "crop-watch");
		if (!cropWatch) throw new Error("crop-watch definition missing");
		const ageMs = cropWatch.timeoutMs + RUNNING_HEARTBEAT_MARGIN_MS;

		findMany.mockResolvedValue(
			overrideJob(freshRows(), "crop-watch", {
				lastRunAt: new Date(NOW.getTime() - ageMs),
				lastStatus: "running",
			}),
		);

		const health = await readCronHealth(NOW);

		expect(jobFrom(health, "crop-watch")).toMatchObject({
			state: "running",
			stale: false,
		});
	});

	it("reports a running marker as hung only after the margin", async () => {
		const cropWatch = CRON_JOBS.find((job) => job.name === "crop-watch");
		if (!cropWatch) throw new Error("crop-watch definition missing");
		const ageMs = cropWatch.timeoutMs + RUNNING_HEARTBEAT_MARGIN_MS + 1;

		findMany.mockResolvedValue(
			overrideJob(freshRows(), "crop-watch", {
				lastRunAt: new Date(NOW.getTime() - ageMs),
				lastStatus: "running",
			}),
		);

		const health = await readCronHealth(NOW);

		expect(health.status).toBe("stale");
		expect(jobFrom(health, "crop-watch")).toMatchObject({
			state: "hung",
			stale: true,
			lastStatus: "running",
		});
	});

	it("keeps a completed crop-watch run healthy just under 26 hours", async () => {
		const justUnder = new Date(NOW.getTime() - (26 * 60 * 60_000 - 60_000));
		findMany.mockResolvedValue(overrideJob(freshRows(), "crop-watch", { lastRunAt: justUnder }));

		const health = await readCronHealth(NOW);

		expect(jobFrom(health, "crop-watch")).toMatchObject({ state: "ok", stale: false });
	});

	it("scrubs stored error text before the public probe returns it", async () => {
		findMany.mockResolvedValue(
			overrideJob(freshRows(), "device-watch", {
				lastStatus: "error",
				lastError: "connect postgresql://optifeed:hunter2@db.example.com/postgres",
			}),
		);

		const health = await readCronHealth(NOW);

		expect(jobFrom(health, "device-watch").lastError).not.toContain("hunter2");
	});
});

describe("cronAlertForJob", () => {
	it("says a hung job started and never finished", async () => {
		const cropWatch = CRON_JOBS.find((job) => job.name === "crop-watch");
		if (!cropWatch) throw new Error("crop-watch definition missing");
		findMany.mockResolvedValue(
			overrideJob(freshRows(), "crop-watch", {
				lastRunAt: new Date(
					NOW.getTime() - (cropWatch.timeoutMs + RUNNING_HEARTBEAT_MARGIN_MS + 60_000),
				),
				lastStatus: "running",
			}),
		);

		const alert = cronAlertForJob(jobFrom(await readCronHealth(NOW), "crop-watch"));

		expect(alert).not.toBeNull();
		expect(alert).toMatchObject({
			fingerprint: "cron:crop-watch:hung",
			route: "cron/crop-watch",
			severity: "CRITICAL",
			job: "crop-watch",
			state: "hung",
		});
		expect(alert?.message).toContain("started");
		expect(alert?.message).toContain("never finished");
	});

	it("names never-run and failed runs, and scrubs stored error text", () => {
		const neverRun: CronHealthRow = {
			name: "crop-watch",
			lastRunAt: null,
			ageMs: null,
			stale: true,
			state: "never-run",
			lastStatus: null,
			lastError: null,
		};
		const failed: CronHealthRow = {
			name: "crop-watch",
			lastRunAt: NOW.toISOString(),
			ageMs: 1_000,
			stale: true,
			state: "error",
			lastStatus: "error",
			lastError: "connect postgresql://optifeed:hunter2@db.example.com/postgres",
		};

		const neverAlert = cronAlertForJob(neverRun);
		const failedAlert = cronAlertForJob(failed);

		expect(neverAlert?.fingerprint).toBe("cron:crop-watch:never-run");
		expect(neverAlert?.message).toContain("never recorded a heartbeat");
		expect(failedAlert?.fingerprint).toBe("cron:crop-watch:error");
		expect(failedAlert?.message).not.toContain("hunter2");
		expect(failedAlert?.message).toContain("[redacted]");
		expect(
			cronAlertForJob({
				...neverRun,
				stale: false,
				state: "ok",
			}),
		).toBeNull();
	});

	it("falls back to unknown schedule details and default error text", () => {
		const unknown = cronAlertForJob({
			name: "not-in-the-list",
			lastRunAt: null,
			ageMs: null,
			stale: true,
			state: "never-run",
			lastStatus: null,
			lastError: null,
		});
		const failedWithoutText = cronAlertForJob({
			name: "crop-watch",
			lastRunAt: NOW.toISOString(),
			ageMs: 1_000,
			stale: true,
			state: "error",
			lastStatus: "error",
			lastError: null,
		});
		const staleWithoutAge = cronAlertForJob({
			name: "crop-watch",
			lastRunAt: NOW.toISOString(),
			ageMs: null,
			stale: true,
			state: "stale",
			lastStatus: "ok",
			lastError: null,
		});

		expect(unknown?.message).toContain("Expected schedule unknown");
		expect(failedWithoutText?.message).toContain("no error text");
		expect(staleWithoutAge?.message).toContain("0 min ago");
	});

	it("returns null for an inconsistent healthy row", () => {
		expect(
			cronAlertForJob({
				name: "crop-watch",
				lastRunAt: NOW.toISOString(),
				ageMs: 1_000,
				stale: true,
				state: "ok",
				lastStatus: "ok",
				lastError: null,
			}),
		).toBeNull();
	});
});

describe("recordCronHeartbeat", () => {
	it("keeps an existing running start time when the job starts again", async () => {
		findUnique.mockResolvedValue({ lastStatus: "running" });

		await recordCronHeartbeat("crop-watch", "running");

		const update = upsert.mock.calls[0][0].update;
		expect(update).toEqual({ lastStatus: "running", lastError: null });
		expect(update).not.toHaveProperty("lastRunAt");
	});

	it("moves the start time when the previous run completed", async () => {
		findUnique.mockResolvedValue({ lastStatus: "ok" });

		await recordCronHeartbeat("crop-watch", "running");

		const update = upsert.mock.calls[0][0].update;
		expect(update.lastStatus).toBe("running");
		expect(update.lastRunAt).toBeInstanceOf(Date);
	});

	it("moves the start time when no heartbeat exists yet", async () => {
		findUnique.mockResolvedValue(null);

		await recordCronHeartbeat("crop-watch", "running");

		const update = upsert.mock.calls[0][0].update;
		expect(update.lastRunAt).toBeInstanceOf(Date);
	});

	it("records a completion and scrubs the stored error text", async () => {
		await recordCronHeartbeat(
			"crop-watch",
			"error",
			new Error("connect postgresql://optifeed:hunter2@db.example.com/postgres"),
		);

		const update = upsert.mock.calls[0][0].update;
		expect(update.lastStatus).toBe("error");
		expect(update.lastError).not.toContain("hunter2");
		expect(update.lastError).toContain("[redacted]");
	});

	it("records a thrown string without losing the error text", async () => {
		await recordCronHeartbeat("crop-watch", "error", "plain failure");

		expect(upsert.mock.calls[0][0].update.lastError).toBe("plain failure");
	});

	it("never throws when the heartbeat write fails", async () => {
		upsert.mockRejectedValue(new Error("database unavailable"));
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(recordCronHeartbeat("crop-watch", "ok")).resolves.toBeUndefined();
		expect(errorLog).toHaveBeenCalled();
	});
});
