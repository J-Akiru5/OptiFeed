import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, policyMock, gatesMock, reportMock } = vi.hoisted(() => ({
	db: {
		energyDevice: { count: vi.fn() },
		feedEvent: { findMany: vi.fn() },
		deviceConnectivityDaily: { deleteMany: vi.fn(), createMany: vi.fn() },
		platformSetting: { findUnique: vi.fn(), upsert: vi.fn() },
		$transaction: vi.fn(),
		$queryRaw: vi.fn(),
	},
	policyMock: vi.fn(),
	gatesMock: vi.fn(),
	reportMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/settings/device-status", () => ({ getDeviceStatusPolicy: policyMock }));
vi.mock("@/lib/settings/firmware-gates", () => ({ getFirmwareGates: gatesMock }));
vi.mock("@/lib/observability", () => ({ reportError: reportMock }));

import { DEFAULT_DEVICE_STATUS_POLICY } from "../device-status";
import {
	CONNECTIVITY_ROLLUP_SETTING_KEY,
	connectivityPruneCutoff,
	countActiveDevices,
	loadConnectivityTrend,
	rollupDeviceConnectivity,
} from "../platform/connectivity";

/**
 * Connectivity history readers and the daily rollup (#479, M3C.10).
 *
 * Covers the O22 active query (heartbeat *or* any feed event, one count), the
 * O24 service that reads stored history only, the rollup window (previous
 * completed UTC day), idempotency (marker), the replace-in-one-transaction
 * rule, the empty-day rule (leave the day absent) and the 90-day prune.
 */

const NOW = new Date("2026-11-02T12:00:00.000Z");
const DAY = new Date("2026-11-01T00:00:00.000Z");
const NEXT_DAY = new Date("2026-11-02T00:00:00.000Z");
const MINUTE = 60 * 1000;

function sample(deviceId: string, minutesAfterMidnight: number, seconds = 0) {
	return {
		deviceId,
		receivedAt: new Date(DAY.getTime() + minutesAfterMidnight * MINUTE + seconds * 1000),
	};
}

function transactionRunner() {
	return vi.fn(async (input: unknown) => {
		if (typeof input === "function") {
			return (input as (tx: typeof db) => Promise<unknown>)(db);
		}
		return Promise.all(input as Promise<unknown>[]);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	policyMock.mockResolvedValue(DEFAULT_DEVICE_STATUS_POLICY);
	gatesMock.mockResolvedValue({ heartbeat_interval_s: 5 });
	db.platformSetting.findUnique.mockResolvedValue(null);
	db.platformSetting.upsert.mockResolvedValue({});
	db.feedEvent.findMany.mockResolvedValue([]);
	db.deviceConnectivityDaily.deleteMany.mockResolvedValue({ count: 0 });
	db.deviceConnectivityDaily.createMany.mockResolvedValue({ count: 0 });
	db.$transaction = transactionRunner();
	db.$queryRaw.mockResolvedValue([]);
});

describe("countActiveDevices (O22)", () => {
	it("counts a device with a recent heartbeat or any recent feed event, once", async () => {
		db.energyDevice.count.mockResolvedValue(4);

		await expect(countActiveDevices(NOW)).resolves.toBe(4);

		const args = db.energyDevice.count.mock.calls[0][0] as {
			where: { OR: unknown[] };
		};
		const cutoff = new Date("2026-10-03T12:00:00.000Z");
		expect(args.where.OR).toEqual([
			{ lastSeenAt: { gte: cutoff } },
			{ feedEvents: { some: { receivedAt: { gte: cutoff } } } },
		]);
		// No event-type or source filter: an imported hand_fed row also counts.
		expect(JSON.stringify(args)).not.toContain("eventType");
		expect(JSON.stringify(args)).not.toContain("source");
	});
});

describe("loadConnectivityTrend (O24)", () => {
	it("reads only the stored rollups for the 90 completed days", async () => {
		db.$queryRaw.mockResolvedValue([
			{
				day: "2026-11-01",
				devicesReporting: 3,
				onlineMinutes: 60,
				observedMinutes: 120,
				gapCount: 1,
				heartbeatCount: 90,
			},
			{
				day: "2026-10-30",
				devicesReporting: 2,
				onlineMinutes: 30,
				observedMinutes: 60,
				gapCount: 0,
				heartbeatCount: 60,
			},
		]);

		const trend = await loadConnectivityTrend(NOW);

		expect(trend.map((point) => point.day)).toEqual(["2026-10-30", "2026-11-01"]);
		expect(trend.map((point) => point.onlineSharePct)).toEqual([50, 50]);

		const sql = (db.$queryRaw.mock.calls[0][0] as unknown as TemplateStringsArray).join(" ");
		expect(sql).toContain('FROM "DeviceConnectivityDaily"');
		expect(sql).toContain('"day" >= ');
		expect(sql).toContain('"day" <= ');
		// No fill, no estimate: a day with no row never comes back.
		expect(sql).not.toContain("generate_series");
	});

	it("returns an empty trend when nothing is stored", async () => {
		await expect(loadConnectivityTrend(NOW)).resolves.toEqual([]);
	});
});

describe("rollupDeviceConnectivity", () => {
	it("aggregates the previous completed UTC day and replaces it in one transaction", async () => {
		db.feedEvent.findMany.mockResolvedValue([
			sample("dev-a", 0),
			sample("dev-a", 5),
			sample("dev-b", 3),
		]);

		const run = await rollupDeviceConnectivity(NOW);

		expect(db.feedEvent.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { eventType: "heartbeat", receivedAt: { gte: DAY, lt: NEXT_DAY } },
				select: { deviceId: true, receivedAt: true },
			}),
		);
		expect(db.$transaction).toHaveBeenCalledTimes(1);
		expect(db.deviceConnectivityDaily.deleteMany).toHaveBeenCalledWith({ where: { day: DAY } });
		expect(db.deviceConnectivityDaily.createMany).toHaveBeenCalledWith({
			data: [
				{
					deviceId: "dev-a",
					day: DAY,
					firstSeenAt: sample("dev-a", 0).receivedAt,
					lastSeenAt: sample("dev-a", 5).receivedAt,
					onlineMinutes: 5,
					heartbeatCount: 2,
					gapCount: 0,
				},
				{
					deviceId: "dev-b",
					day: DAY,
					firstSeenAt: sample("dev-b", 3).receivedAt,
					lastSeenAt: sample("dev-b", 3).receivedAt,
					onlineMinutes: 0,
					heartbeatCount: 1,
					gapCount: 0,
				},
			],
		});
		expect(db.platformSetting.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { key: CONNECTIVITY_ROLLUP_SETTING_KEY },
				update: expect.objectContaining({
					value: expect.objectContaining({ lastRolledUpDay: "2026-11-01" }),
				}),
			}),
		);
		expect(run).toMatchObject({
			processedDays: ["2026-11-01"],
			emptyDays: [],
			devices: 2,
			alreadyRolledUp: false,
		});
	});

	it("does nothing when the marker already covers the previous day", async () => {
		db.platformSetting.findUnique.mockResolvedValue({
			value: { lastRolledUpDay: "2026-11-01", completedAt: "2026-11-02T01:00:00.000Z" },
		});

		const run = await rollupDeviceConnectivity(NOW);

		expect(db.feedEvent.findMany).not.toHaveBeenCalled();
		expect(db.$transaction).not.toHaveBeenCalled();
		expect(db.platformSetting.upsert).not.toHaveBeenCalled();
		expect(run).toMatchObject({ processedDays: [], alreadyRolledUp: true });
	});

	it("leaves a day absent when no heartbeat row survived, and still marks it processed", async () => {
		db.feedEvent.findMany.mockResolvedValue([]);

		const run = await rollupDeviceConnectivity(NOW);

		expect(db.deviceConnectivityDaily.deleteMany).toHaveBeenCalledWith({ where: { day: DAY } });
		expect(db.deviceConnectivityDaily.createMany).not.toHaveBeenCalled();
		expect(run).toMatchObject({
			processedDays: ["2026-11-01"],
			emptyDays: ["2026-11-01"],
			devices: 0,
		});
		// The marker advances so the empty day is never re-scanned.
		expect(db.platformSetting.upsert).toHaveBeenCalledTimes(1);
	});

	it("prunes rows older than the 90-day retention on every run", async () => {
		db.platformSetting.findUnique.mockResolvedValue({
			value: { lastRolledUpDay: "2026-11-01", completedAt: "" },
		});
		db.deviceConnectivityDaily.deleteMany.mockResolvedValue({ count: 7 });

		const run = await rollupDeviceConnectivity(NOW);

		const cutoff = connectivityPruneCutoff(NOW);
		expect(cutoff.toISOString()).toBe("2026-08-04T00:00:00.000Z");
		expect(db.deviceConnectivityDaily.deleteMany).toHaveBeenCalledWith({
			where: { day: { lt: cutoff } },
		});
		expect(run.pruned).toBe(7);
	});

	it("rolls up anyway when the marker cannot be read, and reports it", async () => {
		db.platformSetting.findUnique.mockRejectedValue(new Error("db down"));
		db.feedEvent.findMany.mockResolvedValue([sample("dev-a", 0)]);

		const run = await rollupDeviceConnectivity(NOW);

		expect(reportMock).toHaveBeenCalledTimes(1);
		expect(run.processedDays).toEqual(["2026-11-01"]);
	});
});
