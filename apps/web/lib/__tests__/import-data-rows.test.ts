import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The CSV import job is the inverse of the export job, so its per-type mapping
 * is asserted against the same column names the export writes. Validation
 * failures must name the offending row and must never open a transaction, and
 * a referenced biomass log belonging to another farm must be refused before any
 * write (F-004).
 */

const { resolveActivePond, prisma, tx } = vi.hoisted(() => {
	const tx = {
		biomassLog: { createMany: vi.fn() },
		fishSample: { createMany: vi.fn() },
		feedEvent: { createMany: vi.fn() },
		fcrReport: { createMany: vi.fn() },
		feedLevelLog: { createMany: vi.fn() },
		notification: { createMany: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
		importConfirmation: { create: vi.fn() },
	};
	const prisma = {
		energyDevice: { findMany: vi.fn() },
		biomassLog: { findMany: vi.fn() },
		importConfirmation: { findUnique: vi.fn() },
		$transaction: vi.fn(),
	};
	return { resolveActivePond: vi.fn(), prisma, tx };
});

vi.mock("@/lib/auth/pond-access", () => ({ resolveActivePond }));
vi.mock("@/lib/prisma", () => ({ default: prisma }));

import { confirmImport, importTransactionTimeoutMs } from "@/lib/jobs/import-data";

const CSV: Record<string, string> = {
	biomass_logs:
		"sampleWeightKg,sampleCount,sampleLengthCm,recordedAt\n10,5,22,2026-03-02T04:00:00Z",
	fish_samples: "biomassLogId,weightGrams,lengthCm\nlog-1,120,21",
	feed_events:
		"eventId,eventType,timestamp,grams,source,feedRequestId,commandId,receivedAt\nreq-1,feed_dispensed,2026-03-02T04:00:00Z,150,schedule,fr-1,cmd-1,2026-03-02T04:00:05Z",
	fcr_reports:
		"periodStart,periodEnd,totalFeedKg,biomassGainKg,fcrValue\n2026-03-01T00:00:00Z,2026-03-31T00:00:00Z,400,250,1.6",
	feed_level_logs: "levelPercent,distanceCm,recordedAt\n62,18,2026-03-02T04:00:00Z",
	notifications:
		"tier,message,linkTo,read,category,autoCleared,createdAt\nwarning,Hopper low,summary,false,hopper,false,2026-03-02T04:00:00Z",
};

beforeEach(() => {
	vi.clearAllMocks();
	// An explicit pond is returned only when it is in the caller's ACTIVE set;
	// the mock mirrors that by echoing the requested id and defaulting to pond-1.
	resolveActivePond.mockImplementation(async (_ownerId: string, pondId?: string | null) => ({
		id: pondId ?? "pond-1",
	}));
	prisma.energyDevice.findMany.mockResolvedValue([{ id: "dev-1" }]);
	prisma.biomassLog.findMany.mockResolvedValue([{ id: "log-1" }]);
	prisma.importConfirmation.findUnique.mockResolvedValue(null);
	prisma.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<number>) =>
		fn(tx),
	);
	for (const model of Object.values(tx)) {
		for (const delegate of Object.values(model)) {
			vi.mocked(delegate).mockResolvedValue({ count: 1 } as never);
		}
	}
});

describe("import guards", () => {
	it("reports a farm with no active pond as 404 before parsing", async () => {
		resolveActivePond.mockResolvedValue(null);

		await expect(confirmImport("farm-a", "biomass_logs", CSV.biomass_logs)).rejects.toMatchObject({
			status: 404,
		});
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("refuses a biomass log id owned by another farm before opening the transaction", async () => {
		prisma.biomassLog.findMany.mockResolvedValue([]);

		await expect(confirmImport("farm-a", "fish_samples", CSV.fish_samples)).rejects.toMatchObject({
			status: 400,
			message: "One or more biomassLogId values are not owned by this farm.",
		});
		expect(prisma.biomassLog.findMany).toHaveBeenCalledWith({
			where: { id: { in: ["log-1"] }, pond: { id: "pond-1", ownerId: "farm-a" } },
			select: { id: true },
		});
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("refuses an audit-event import instead of writing caller-supplied provenance", async () => {
		await expect(
			confirmImport(
				"farm-a",
				"audit_events" as never,
				"eventType,source,actorId,createdAt\nlogin,import,sb-victim,2020-01-01T00:00:00Z",
			),
		).rejects.toMatchObject({ status: 400, message: "Unknown import type." });
		expect(prisma.$transaction).not.toHaveBeenCalled();
		expect(tx.deviceStateEvent.create).not.toHaveBeenCalled();
	});
});

describe("target pond pinning (#743)", () => {
	it("resolves and writes to the pond carried by the job, not the active one", async () => {
		const result = await confirmImport("farm-a", "biomass_logs", CSV.biomass_logs, {
			pondId: "pond-2",
		});

		expect(result).toEqual({ importedCount: 1 });
		expect(resolveActivePond).toHaveBeenCalledWith("farm-a", "pond-2");
		expect(prisma.energyDevice.findMany).toHaveBeenCalledWith({
			where: { pondId: "pond-2" },
			select: { id: true },
			orderBy: { createdAt: "asc" },
			take: 100,
		});
		expect(tx.biomassLog.createMany.mock.calls[0][0].data[0]).toMatchObject({
			pondId: "pond-2",
		});
	});

	it("rejects a pond the caller does not own before replay or parsing", async () => {
		resolveActivePond.mockResolvedValue(null);

		await expect(
			confirmImport("farm-a", "biomass_logs", CSV.biomass_logs, { pondId: "pond-foreign" }),
		).rejects.toMatchObject({ status: 404, message: "Pond not found." });
		expect(prisma.importConfirmation.findUnique).not.toHaveBeenCalled();
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("rejects a row exported from a different pond", async () => {
		await expect(
			confirmImport(
				"farm-a",
				"biomass_logs",
				"pondId,sampleWeightKg,sampleCount\npond-1,10,5",
				{ pondId: "pond-2" },
			),
		).rejects.toMatchObject({
			status: 400,
			message: "Row 1: pondId does not match the selected pond.",
		});
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("accepts rows that name the selected pond", async () => {
		await confirmImport(
			"farm-a",
			"biomass_logs",
			"pondId,sampleWeightKg,sampleCount\npond-2,10,5",
			{ pondId: "pond-2" },
		);

		expect(tx.biomassLog.createMany).toHaveBeenCalledTimes(1);
	});

	it("rejects a device id from another pond instead of remapping it", async () => {
		prisma.energyDevice.findMany.mockResolvedValue([{ id: "dev-2" }]);

		await expect(
			confirmImport(
				"farm-a",
				"feed_events",
				"deviceId,eventType,timestamp\ndev-1,feed_dispensed,2026-03-02T04:00:00Z",
				{ pondId: "pond-2" },
			),
		).rejects.toMatchObject({
			status: 400,
			message: "Row 1: deviceId does not belong to the selected pond.",
		});
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("keeps a per-row device that belongs to the selected pond", async () => {
		prisma.energyDevice.findMany.mockResolvedValue([{ id: "dev-2" }, { id: "dev-3" }]);

		await confirmImport(
			"farm-a",
			"feed_events",
			"deviceId,eventType,timestamp\n" +
				"dev-3,feed_dispensed,2026-03-02T04:00:00Z\n" +
				"dev-2,feed_dispensed,2026-03-02T05:00:00Z",
			{ pondId: "pond-2" },
		);

		expect(
			tx.feedEvent.createMany.mock.calls[0][0].data.map(
				(row: { deviceId: string }) => row.deviceId,
			),
		).toEqual(["dev-3", "dev-2"]);
	});
});

describe("row validation", () => {
	it("rejects a non-positive sample weight and names the row", async () => {
		await expect(
			confirmImport("farm-a", "biomass_logs", "sampleWeightKg,sampleCount\n0,5"),
		).rejects.toMatchObject({ status: 400, message: "Row 1: sampleWeightKg is invalid." });
		// Validation runs inside the transaction callback, so the bulk insert is
		// what must not happen (the transaction is rolled back by Prisma).
		expect(tx.biomassLog.createMany).not.toHaveBeenCalled();
		expect(tx.deviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("rejects a fractional sample count", async () => {
		await expect(
			confirmImport("farm-a", "biomass_logs", "sampleWeightKg,sampleCount\n10,2.5"),
		).rejects.toMatchObject({ message: "Row 1: sampleCount is invalid." });
	});

	it("rejects a negative length for the second row", async () => {
		await expect(
			confirmImport(
				"farm-a",
				"biomass_logs",
				"sampleWeightKg,sampleCount,sampleLengthCm\n10,5,20\n10,5,-1",
			),
		).rejects.toMatchObject({ message: "Row 2: sampleLengthCm is invalid." });
	});

	it("rejects a required period date that cannot be parsed", async () => {
		await expect(
			confirmImport(
				"farm-a",
				"fcr_reports",
				"periodStart,periodEnd,totalFeedKg,biomassGainKg,fcrValue\nnot-a-date,2026-03-31,1,1,1",
			),
		).rejects.toMatchObject({ message: "Row 1: periodStart is not a valid date." });
	});
});

describe("per-type row mapping", () => {
	it("derives the average weight and stamps the import source", async () => {
		await confirmImport("farm-a", "biomass_logs", CSV.biomass_logs);

		const { data } = tx.biomassLog.createMany.mock.calls[0][0];
		expect(data).toEqual([
			{
				pondId: "pond-1",
				sampleWeightKg: 10,
				sampleLengthCm: 22,
				sampleCount: 5,
				avgWeightKg: 2,
				source: "import",
				recordedAt: new Date("2026-03-02T04:00:00Z"),
			},
		]);
	});

	it("keeps fish samples tied to their parent log", async () => {
		await confirmImport("farm-a", "fish_samples", CSV.fish_samples);

		expect(tx.fishSample.createMany.mock.calls[0][0].data).toEqual([
			{ biomassLogId: "log-1", weightGrams: 120, lengthCm: 21 },
		]);
	});

	it("attaches feed events to the pond's oldest device and keeps optional ids", async () => {
		await confirmImport("farm-a", "feed_events", CSV.feed_events);

		expect(prisma.energyDevice.findMany).toHaveBeenCalledWith({
			where: { pondId: "pond-1" },
			select: { id: true },
			orderBy: { createdAt: "asc" },
			take: 100,
		});
		expect(tx.feedEvent.createMany.mock.calls[0][0].data).toEqual([
			{
				deviceId: "dev-1",
				eventId: "req-1",
				eventType: "feed_dispensed",
				timestamp: "2026-03-02T04:00:00Z",
				grams: 150,
				source: "schedule",
				feedRequestId: "fr-1",
				commandId: "cmd-1",
				rtcOk: null,
				feederActive: null,
				receivedAt: new Date("2026-03-02T04:00:05Z"),
			},
		]);
	});

	it("refuses feed events for a pond with no device", async () => {
		prisma.energyDevice.findMany.mockResolvedValue([]);

		await expect(confirmImport("farm-a", "feed_events", CSV.feed_events)).rejects.toThrow(
			"No device found",
		);
		expect(tx.feedEvent.createMany).not.toHaveBeenCalled();
	});

	it("parses both FCR period boundaries", async () => {
		await confirmImport("farm-a", "fcr_reports", CSV.fcr_reports);

		expect(tx.fcrReport.createMany.mock.calls[0][0].data).toEqual([
			{
				pondId: "pond-1",
				periodStart: new Date("2026-03-01T00:00:00Z"),
				periodEnd: new Date("2026-03-31T00:00:00Z"),
				totalFeedKg: 400,
				biomassGainKg: 250,
				fcrValue: 1.6,
			},
		]);
	});

	it("attaches feed level logs to the device", async () => {
		await confirmImport("farm-a", "feed_level_logs", CSV.feed_level_logs);

		expect(tx.feedLevelLog.createMany.mock.calls[0][0].data).toEqual([
			{
				deviceId: "dev-1",
				levelPercent: 62,
				distanceCm: 18,
				recordedAt: new Date("2026-03-02T04:00:00Z"),
			},
		]);
	});

	it("turns notification flags into booleans and empty links into null", async () => {
		await confirmImport(
			"farm-a",
			"notifications",
			"tier,message,linkTo,read\nwarning,Hopper low,,true",
		);

		expect(tx.notification.createMany.mock.calls[0][0].data).toEqual([
			{
				pondId: "pond-1",
				tier: "warning",
				message: "Hopper low",
				linkTo: null,
				read: true,
				category: null,
				autoCleared: false,
				createdAt: expect.any(Date),
			},
		]);
	});

	it("reads FALSE as false, not as the truthy string", async () => {
		await confirmImport(
			"farm-a",
			"notifications",
			"tier,message,read,autoCleared\nwarning,Hopper low,FALSE,0",
		);
		await confirmImport(
			"farm-a",
			"feed_events",
			"eventType,timestamp,rtcOk,feederActive\nfeed_dispensed,2026-03-02T04:00:00Z,false,TRUE",
		);

		expect(tx.notification.createMany.mock.calls[0][0].data[0]).toMatchObject({
			read: false,
			autoCleared: false,
		});
		expect(tx.feedEvent.createMany.mock.calls[0][0].data[0]).toMatchObject({
			rtcOk: false,
			feederActive: true,
		});
	});

	it("keeps an empty flag cell as null on feed events and rejects an unreadable one", async () => {
		await confirmImport(
			"farm-a",
			"feed_events",
			"eventType,timestamp,rtcOk\nfeed_dispensed,2026-03-02T04:00:00Z,",
		);
		expect(tx.feedEvent.createMany.mock.calls[0][0].data[0].rtcOk).toBeNull();

		await expect(
			confirmImport("farm-a", "notifications", "tier,message,read\nwarning,Hopper low,maybe"),
		).rejects.toMatchObject({ status: 400, message: "Row 1: read must be TRUE or FALSE." });
	});
});

describe("transaction budget (#758)", () => {
	it("keeps the transaction shorter than the job that owns it", () => {
		expect(importTransactionTimeoutMs(12_000)).toBe(8_000);
		expect(importTransactionTimeoutMs(5_000)).toBe(1_000);
		expect(importTransactionTimeoutMs(1_000)).toBe(500);
		for (const limit of [1_000, 5_000, 12_000, 30_000]) {
			expect(importTransactionTimeoutMs(limit)).toBeLessThan(limit);
		}
	});
});

describe("import audit trail", () => {
	it("writes one data_imported event with server-generated provenance", async () => {
		tx.biomassLog.createMany.mockResolvedValue({ count: 3 } as never);

		const result = await confirmImport(
			"farm-a",
			"biomass_logs",
			"sampleWeightKg,sampleCount\n10,5\n12,6\n14,7",
			{ pondId: "pond-2" },
		);

		expect(result).toEqual({ importedCount: 3 });
		expect(tx.deviceStateEvent.create).toHaveBeenCalledTimes(1);
		expect(tx.deviceStateEvent.create.mock.calls[0][0]).toEqual({
			data: {
				deviceId: "dev-1",
				eventType: "data_imported",
				source: "user",
				actorId: "farm-a",
				metadata: { type: "biomass_logs", count: 3, pondId: "pond-2" },
			},
		});
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 8_000 });
	});

	it("skips the audit event when the pond has no device", async () => {
		prisma.energyDevice.findMany.mockResolvedValue([]);

		await confirmImport("farm-a", "biomass_logs", CSV.biomass_logs);

		expect(tx.biomassLog.createMany).toHaveBeenCalledTimes(1);
		expect(tx.deviceStateEvent.create).not.toHaveBeenCalled();
	});
});
