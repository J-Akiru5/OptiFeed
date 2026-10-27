import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	groupBy: vi.fn(),
	findFirst: vi.fn(),
	findMany: vi.fn(),
	stateFindFirst: vi.fn(),
	reminderFindFirst: vi.fn(),
	deviceFindMany: vi.fn(),
	queryRaw: vi.fn(),
	gate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		backgroundJob: {
			groupBy: mocks.groupBy,
			findFirst: mocks.findFirst,
			findMany: mocks.findMany,
		},
		deviceStateEvent: { findFirst: mocks.stateFindFirst },
		reminderLog: { findFirst: mocks.reminderFindFirst },
		energyDevice: { findMany: mocks.deviceFindMany },
		$queryRaw: mocks.queryRaw,
	},
}));

vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: mocks.gate,
}));

import {
	type HealthDeviceRow,
	getSystemHealth,
	isDeviceOffline,
	parseDeviceSort,
	sortHealthDevices,
} from "@/lib/platform/health";

const NOW = new Date("2026-10-27T12:00:00.000Z");

const devices: HealthDeviceRow[] = [
	{
		id: "a",
		label: "Alpha",
		mac: "AA:AA",
		lastSeenAt: new Date("2026-10-27T11:55:00.000Z"),
		pondName: "Pond A",
	},
	{ id: "b", label: "Charlie", mac: "CC:CC", lastSeenAt: null, pondName: null },
	{
		id: "c",
		label: "bravo",
		mac: "BB:BB",
		lastSeenAt: new Date("2026-10-26T12:00:00.000Z"),
		pondName: null,
	},
];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.gate.mockResolvedValue(undefined);

	mocks.groupBy.mockResolvedValue([
		{ status: "queued", _count: { _all: 2 } },
		{ status: "running", _count: { _all: 1 } },
		{ status: "failed", _count: { _all: 3 } },
		{ status: "succeeded", _count: { _all: 10 } },
	]);
	mocks.findMany.mockResolvedValue([
		{
			id: "job-1",
			type: "export_csv",
			error: "disk full",
			attempts: 2,
			finishedAt: new Date("2026-10-27T10:00:00.000Z"),
			createdAt: new Date("2026-10-27T09:59:00.000Z"),
		},
	]);
	mocks.findFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
		if (args.where?.status === "queued") {
			return {
				id: "job-old",
				type: "import_confirm",
				createdAt: new Date("2026-10-27T08:00:00.000Z"),
			};
		}
		if (args.where?.startedAt) {
			return {
				startedAt: new Date("2026-10-27T09:00:00.000Z"),
				type: "export_csv",
			};
		}
		return null;
	});
	mocks.stateFindFirst.mockResolvedValue({
		createdAt: new Date("2026-10-27T07:00:00.000Z"),
		eventType: "disconnected",
	});
	mocks.reminderFindFirst.mockResolvedValue({
		sentAt: new Date("2026-10-27T06:00:00.000Z"),
		kind: "sampling_due",
	});
	mocks.deviceFindMany.mockResolvedValue(
		devices.map((device) => ({
			...device,
			pond: device.pondName ? { name: device.pondName } : null,
		})),
	);
	mocks.queryRaw.mockResolvedValue([]);
	mocks.queryRaw.mockResolvedValueOnce([{ day: "2026-10-27", total: 4 }]);
	mocks.queryRaw.mockResolvedValueOnce([{ day: "2026-10-27", total: 2 }]);
});

describe("parseDeviceSort", () => {
	it("defaults to the newest last contact first", () => {
		expect(parseDeviceSort(undefined, undefined)).toEqual({
			field: "lastSeen",
			direction: "desc",
		});
	});

	it("defaults names and MACs to A→Z", () => {
		expect(parseDeviceSort("label", undefined)).toEqual({ field: "label", direction: "asc" });
		expect(parseDeviceSort("mac", undefined)).toEqual({ field: "mac", direction: "asc" });
	});

	it("rejects unknown fields and directions", () => {
		expect(parseDeviceSort("owner", "sideways")).toEqual({
			field: "lastSeen",
			direction: "desc",
		});
	});

	it("keeps an explicit direction", () => {
		expect(parseDeviceSort("label", "desc")).toEqual({ field: "label", direction: "desc" });
	});
});

describe("sortHealthDevices", () => {
	it("sorts by last contact newest first and puts never-seen last", () => {
		const sorted = sortHealthDevices(devices, "lastSeen", "desc");
		expect(sorted.map((row) => row.id)).toEqual(["a", "c", "b"]);
	});

	it("keeps never-seen devices last even when ascending", () => {
		const sorted = sortHealthDevices(devices, "lastSeen", "asc");
		expect(sorted.map((row) => row.id)).toEqual(["c", "a", "b"]);
	});

	it("sorts labels case-insensitively", () => {
		const sorted = sortHealthDevices(devices, "label", "asc");
		expect(sorted.map((row) => row.label)).toEqual(["Alpha", "bravo", "Charlie"]);
	});
});

describe("isDeviceOffline", () => {
	it("treats a missing reading as offline", () => {
		expect(isDeviceOffline(null, NOW)).toBe(true);
	});

	it("uses the 15-minute window", () => {
		expect(isDeviceOffline(new Date(NOW.getTime() - 5 * 60 * 1000), NOW)).toBe(false);
		expect(isDeviceOffline(new Date(NOW.getTime() - 16 * 60 * 1000), NOW)).toBe(true);
	});
});

describe("getSystemHealth", () => {
	it("requires a platform admin before touching the database", async () => {
		mocks.gate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(getSystemHealth(NOW)).rejects.toThrow("NEXT_REDIRECT");

		expect(mocks.groupBy).not.toHaveBeenCalled();
		expect(mocks.deviceFindMany).not.toHaveBeenCalled();
		expect(mocks.queryRaw).not.toHaveBeenCalled();
	});

	it("summarises job counts, failures, cron inference and devices", async () => {
		const health = await getSystemHealth(NOW, 2);

		expect(health.jobs).toMatchObject({
			total: 16,
			queued: 2,
			running: 1,
			failed: 3,
			succeeded: 10,
		});
		expect(health.jobs.oldestQueued).toMatchObject({ id: "job-old", type: "import_confirm" });
		expect(health.jobs.recentFailures).toHaveLength(1);

		expect(health.cron).toEqual([
			{
				job: "device-watch",
				lastActivityAt: new Date("2026-10-27T07:00:00.000Z"),
				eventType: "disconnected",
			},
			{
				job: "crop-watch",
				lastActivityAt: new Date("2026-10-27T06:00:00.000Z"),
				eventType: "sampling_due",
			},
			{
				job: "jobs",
				lastActivityAt: new Date("2026-10-27T09:00:00.000Z"),
				eventType: "export_csv",
			},
		]);

		expect(health.dayKeys).toHaveLength(14);
		expect(health.jobs.jobsPerDay).toHaveLength(14);
		expect(health.jobs.jobsPerDay.at(-1)).toEqual({ label: "2026-10-27", value: 4 });
		expect(health.jobs.failuresPerDay.at(-1)).toEqual({ label: "2026-10-27", value: 2 });

		// The query asks for one extra row so the page learns the list was cut.
		expect(mocks.deviceFindMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: 3, orderBy: { label: "asc" } }),
		);
		expect(health.devices).toHaveLength(2);
		expect(health.devicesTruncated).toBe(true);
	});

	it("reports no inferred cron activity when the jobs left no rows", async () => {
		mocks.stateFindFirst.mockResolvedValue(null);
		mocks.reminderFindFirst.mockResolvedValue(null);
		mocks.findFirst.mockResolvedValue(null);
		mocks.deviceFindMany.mockResolvedValue([]);

		const health = await getSystemHealth(NOW);

		expect(health.cron.map((row) => row.lastActivityAt)).toEqual([null, null, null]);
		expect(health.devicesTruncated).toBe(false);
	});
});
