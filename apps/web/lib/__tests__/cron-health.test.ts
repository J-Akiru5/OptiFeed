import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
	default: { cronHeartbeat: { findMany } },
}));

import { readCronHealth } from "@/lib/ops/cron-heartbeat";

const NOW = new Date("2026-11-04T12:00:00.000Z");

beforeEach(() => {
	vi.clearAllMocks();
});

describe("readCronHealth (#725)", () => {
	it("reports stale when any known cron has never run", async () => {
		findMany.mockResolvedValue([]);

		const health = await readCronHealth(NOW);

		expect(health.status).toBe("stale");
		expect(health.jobs.map((job) => job.name)).toEqual([
			"device-watch",
			"background-jobs",
			"crop-watch",
		]);
		expect(health.jobs.every((job) => job.stale)).toBe(true);
	});

	it("reports ok when every heartbeat is fresh", async () => {
		findMany.mockResolvedValue([
			{
				name: "device-watch",
				lastRunAt: new Date("2026-11-04T11:58:00Z"),
				lastStatus: "ok",
				lastError: null,
			},
			{
				name: "background-jobs",
				lastRunAt: new Date("2026-11-04T11:59:00Z"),
				lastStatus: "ok",
				lastError: null,
			},
			{
				name: "crop-watch",
				lastRunAt: new Date("2026-11-03T22:01:00Z"),
				lastStatus: "ok",
				lastError: null,
			},
		]);

		const health = await readCronHealth(NOW);

		expect(health.status).toBe("ok");
		expect(health.jobs.every((job) => !job.stale)).toBe(true);
	});

	it("marks a fresh heartbeat stale when its last run errored", async () => {
		findMany.mockResolvedValue([
			{
				name: "device-watch",
				lastRunAt: new Date("2026-11-04T11:59:00Z"),
				lastStatus: "error",
				lastError: "boom",
			},
		]);

		const health = await readCronHealth(NOW);
		const deviceWatch = health.jobs.find((job) => job.name === "device-watch");

		expect(deviceWatch).toMatchObject({ stale: true, lastStatus: "error", lastError: "boom" });
	});

	it("marks a heartbeat older than its schedule stale", async () => {
		findMany.mockResolvedValue([
			{
				name: "background-jobs",
				lastRunAt: new Date("2026-11-04T11:40:00Z"),
				lastStatus: "ok",
				lastError: null,
			},
		]);

		const health = await readCronHealth(NOW);

		expect(health.jobs.find((job) => job.name === "background-jobs")?.stale).toBe(true);
	});
});
