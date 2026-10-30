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
		deviceStateEvent: { createMany: vi.fn(), create: vi.fn() },
	};
	const prisma = {
		energyDevice: { findFirst: vi.fn() },
		biomassLog: { findMany: vi.fn() },
		$transaction: vi.fn(),
	};
	return { resolveActivePond: vi.fn(), prisma, tx };
});

vi.mock("@/lib/auth/pond-access", () => ({ resolveActivePond }));
vi.mock("@/lib/prisma", () => ({ default: prisma }));

import { confirmImport } from "@/lib/jobs/import-data";

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
	audit_events:
		'eventType,source,actorId,metadata,deviceTime,createdAt\nfeed_dispensed,device,,{"grams":150},2026-03-02T04:00:00Z,2026-03-02T04:00:00Z',
};

beforeEach(() => {
	vi.clearAllMocks();
	resolveActivePond.mockResolvedValue({ id: "pond-1" });
	prisma.energyDevice.findFirst.mockResolvedValue({ id: "dev-1" });
	prisma.biomassLog.findMany.mockResolvedValue([{ id: "log-1" }]);
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
			where: { id: { in: ["log-1"] }, pond: { ownerId: "farm-a" } },
			select: { id: true },
		});
		expect(prisma.$transaction).not.toHaveBeenCalled();
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

		expect(prisma.energyDevice.findFirst).toHaveBeenCalledWith({
			where: { pondId: "pond-1" },
			orderBy: { createdAt: "asc" },
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
		prisma.energyDevice.findFirst.mockResolvedValue(null);

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

	it("parses audit metadata JSON", async () => {
		await confirmImport("farm-a", "audit_events", CSV.audit_events);

		expect(tx.deviceStateEvent.createMany.mock.calls[0][0].data).toEqual([
			{
				deviceId: "dev-1",
				eventType: "feed_dispensed",
				source: "device",
				actorId: null,
				metadata: { grams: 150 },
				deviceTime: "2026-03-02T04:00:00Z",
				createdAt: new Date("2026-03-02T04:00:00Z"),
			},
		]);
	});

	it("keeps unparseable audit metadata as a raw string instead of dropping it", async () => {
		await confirmImport(
			"farm-a",
			"audit_events",
			"eventType,source,metadata\nfeed_dispensed,device,not-json",
		);

		expect(tx.deviceStateEvent.createMany.mock.calls[0][0].data[0].metadata).toEqual({
			raw: "not-json",
		});
	});
});

describe("import audit trail", () => {
	it("writes one data_imported event with the type and row count", async () => {
		tx.biomassLog.createMany.mockResolvedValue({ count: 3 } as never);

		const result = await confirmImport(
			"farm-a",
			"biomass_logs",
			"sampleWeightKg,sampleCount\n10,5\n12,6\n14,7",
		);

		expect(result).toEqual({ importedCount: 3 });
		expect(tx.deviceStateEvent.create).toHaveBeenCalledTimes(1);
		expect(tx.deviceStateEvent.create.mock.calls[0][0]).toEqual({
			data: {
				deviceId: "dev-1",
				eventType: "data_imported",
				source: "user",
				actorId: "farm-a",
				metadata: { type: "biomass_logs", count: 3 },
			},
		});
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
	});

	it("skips the audit event when the pond has no device", async () => {
		prisma.energyDevice.findFirst.mockResolvedValue(null);

		await confirmImport("farm-a", "biomass_logs", CSV.biomass_logs);

		expect(tx.biomassLog.createMany).toHaveBeenCalledTimes(1);
		expect(tx.deviceStateEvent.create).not.toHaveBeenCalled();
	});
});
