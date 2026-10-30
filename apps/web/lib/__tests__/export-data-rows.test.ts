import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Column contracts for the data-export jobs.
 *
 * The CSV columns are the public shape of a downloaded file, so each mapping is
 * asserted field by field: an accidental rename or a dropped null column is a
 * user-visible regression, not a cosmetic one. The queries are asserted too,
 * because every export must stay inside the caller's active pond.
 */

const { resolveActivePond, prisma } = vi.hoisted(() => {
	const prisma = {
		energyDevice: { findMany: vi.fn() },
		biomassLog: { findMany: vi.fn() },
		fishSample: { findMany: vi.fn() },
		feedEvent: { findMany: vi.fn() },
		fcrReport: { findMany: vi.fn() },
		feedLevelLog: { findMany: vi.fn() },
		notification: { findMany: vi.fn() },
		deviceStateEvent: { findMany: vi.fn() },
	};
	return { resolveActivePond: vi.fn(), prisma };
});

vi.mock("@/lib/auth/pond-access", () => ({ resolveActivePond }));
vi.mock("@/lib/prisma", () => ({ default: prisma }));

import {
	buildBatchExport,
	buildCsvExport,
	buildExportRows,
	loadExportContext,
} from "@/lib/jobs/export-data";

const CONTEXT = { pondId: "pond-1", deviceIds: ["dev-1", "dev-2"], deviceId: "dev-1" };
const AT = new Date("2026-03-02T04:05:06.000Z");
const ISO = AT.toISOString();

beforeEach(() => {
	vi.clearAllMocks();
	resolveActivePond.mockResolvedValue({ id: "pond-1" });
	prisma.energyDevice.findMany.mockResolvedValue([{ id: "dev-1" }, { id: "dev-2" }]);
	prisma.biomassLog.findMany.mockResolvedValue([]);
	prisma.fishSample.findMany.mockResolvedValue([]);
	prisma.feedEvent.findMany.mockResolvedValue([]);
	prisma.fcrReport.findMany.mockResolvedValue([]);
	prisma.feedLevelLog.findMany.mockResolvedValue([]);
	prisma.notification.findMany.mockResolvedValue([]);
	prisma.deviceStateEvent.findMany.mockResolvedValue([]);
});

describe("loadExportContext", () => {
	it("scopes the device lookup to the active pond and keeps the first device", async () => {
		const context = await loadExportContext("farm-a");

		expect(context).toEqual({ pondId: "pond-1", deviceIds: ["dev-1", "dev-2"], deviceId: "dev-1" });
		expect(prisma.energyDevice.findMany).toHaveBeenCalledWith({
			where: { pondId: "pond-1" },
			select: { id: true },
			take: 100,
		});
	});

	it("reports a pond with no registered device as a null device id", async () => {
		prisma.energyDevice.findMany.mockResolvedValue([]);

		await expect(loadExportContext("farm-a")).resolves.toEqual({
			pondId: "pond-1",
			deviceIds: [],
			deviceId: null,
		});
	});
});

describe("buildExportRows biomass_logs", () => {
	it("maps every column and serialises the timestamp", async () => {
		prisma.biomassLog.findMany.mockResolvedValue([
			{
				id: "log-1",
				pondId: "pond-1",
				sampleWeightKg: 1.25,
				sampleLengthCm: 22,
				sampleCount: 10,
				avgWeightKg: 0.125,
				batchLabel: "Batch A",
				recordedAt: AT,
			},
		]);

		const rows = await buildExportRows(CONTEXT, "biomass_logs");

		expect(rows).toEqual([
			{
				id: "log-1",
				pondId: "pond-1",
				sampleWeightKg: 1.25,
				sampleLengthCm: 22,
				sampleCount: 10,
				avgWeightKg: 0.125,
				batchLabel: "Batch A",
				recordedAt: ISO,
			},
		]);
		expect(prisma.biomassLog.findMany).toHaveBeenCalledWith({
			where: { pondId: "pond-1" },
			orderBy: { recordedAt: "asc" },
			take: 50_000,
		});
	});

	it("keeps a missing batch label as null instead of dropping the column", async () => {
		prisma.biomassLog.findMany.mockResolvedValue([
			{
				id: "log-1",
				pondId: "pond-1",
				sampleWeightKg: 1,
				sampleLengthCm: 20,
				sampleCount: 5,
				avgWeightKg: 0.2,
				batchLabel: null,
				recordedAt: AT,
			},
		]);

		const [row] = await buildExportRows(CONTEXT, "biomass_logs");

		expect(row.batchLabel).toBeNull();
	});
});

describe("buildExportRows fish_samples", () => {
	it("joins the parent log's batch label and timestamp", async () => {
		prisma.biomassLog.findMany.mockResolvedValue([
			{ id: "log-1", batchLabel: "Batch A", recordedAt: AT },
		]);
		prisma.fishSample.findMany.mockResolvedValue([
			{ id: "s-1", biomassLogId: "log-1", weightGrams: 120, lengthCm: 21 },
		]);

		const rows = await buildExportRows(CONTEXT, "fish_samples");

		expect(rows).toEqual([
			{
				id: "s-1",
				biomassLogId: "log-1",
				batchLabel: "Batch A",
				weightGrams: 120,
				lengthCm: 21,
				recordedAt: ISO,
			},
		]);
		expect(prisma.fishSample.findMany).toHaveBeenCalledWith({
			where: { biomassLogId: { in: ["log-1"] } },
			orderBy: { id: "asc" },
			take: 50_000,
		});
	});

	it("leaves the label and timestamp null when the parent log is out of range", async () => {
		prisma.biomassLog.findMany.mockResolvedValue([]);
		prisma.fishSample.findMany.mockResolvedValue([
			{ id: "s-1", biomassLogId: "log-gone", weightGrams: 120, lengthCm: 21 },
		]);

		const [row] = await buildExportRows(CONTEXT, "fish_samples");

		expect(row).toMatchObject({ batchLabel: null, recordedAt: null });
	});
});

describe("buildExportRows feed_events", () => {
	it("exports the device event fields scoped to the pond's devices", async () => {
		prisma.feedEvent.findMany.mockResolvedValue([
			{
				id: "fe-1",
				deviceId: "dev-1",
				eventId: "evt-1",
				eventType: "feed_dispensed",
				timestamp: "2026-03-02T04:00:00.000Z",
				grams: 150,
				source: "schedule",
				feedRequestId: "req-1",
				commandId: "cmd-1",
				rtcOk: true,
				feederActive: false,
				receivedAt: AT,
			},
		]);

		const rows = await buildExportRows(CONTEXT, "feed_events");

		expect(rows[0]).toEqual({
			id: "fe-1",
			deviceId: "dev-1",
			eventId: "evt-1",
			eventType: "feed_dispensed",
			timestamp: "2026-03-02T04:00:00.000Z",
			grams: 150,
			source: "schedule",
			feedRequestId: "req-1",
			commandId: "cmd-1",
			rtcOk: true,
			feederActive: false,
			receivedAt: ISO,
		});
		expect(prisma.feedEvent.findMany).toHaveBeenCalledWith({
			where: { deviceId: { in: ["dev-1", "dev-2"] } },
			orderBy: { receivedAt: "asc" },
			take: 50_000,
		});
	});
});

describe("buildExportRows fcr_reports", () => {
	it("serialises both period boundaries", async () => {
		const end = new Date("2026-03-31T00:00:00.000Z");
		prisma.fcrReport.findMany.mockResolvedValue([
			{
				id: "fcr-1",
				pondId: "pond-1",
				periodStart: AT,
				periodEnd: end,
				totalFeedKg: 400,
				biomassGainKg: 250,
				fcrValue: 1.6,
			},
		]);

		const [row] = await buildExportRows(CONTEXT, "fcr_reports");

		expect(row).toEqual({
			id: "fcr-1",
			pondId: "pond-1",
			periodStart: ISO,
			periodEnd: end.toISOString(),
			totalFeedKg: 400,
			biomassGainKg: 250,
			fcrValue: 1.6,
		});
		expect(prisma.fcrReport.findMany).toHaveBeenCalledWith({
			where: { pondId: "pond-1" },
			orderBy: { periodEnd: "asc" },
			take: 50_000,
		});
	});
});

describe("buildExportRows feed_level_logs", () => {
	it("exports the active device's level history", async () => {
		prisma.feedLevelLog.findMany.mockResolvedValue([
			{ id: "fl-1", deviceId: "dev-1", levelPercent: 62, distanceCm: 18, recordedAt: AT },
		]);

		const rows = await buildExportRows(CONTEXT, "feed_level_logs");

		expect(rows).toEqual([
			{ id: "fl-1", deviceId: "dev-1", levelPercent: 62, distanceCm: 18, recordedAt: ISO },
		]);
		expect(prisma.feedLevelLog.findMany).toHaveBeenCalledWith({
			where: { deviceId: "dev-1" },
			orderBy: { recordedAt: "asc" },
			take: 50_000,
		});
	});

	it("refuses a level export for a farm with no device instead of returning an empty file", async () => {
		const context = { pondId: "pond-1", deviceIds: [], deviceId: null };

		await expect(buildExportRows(context, "feed_level_logs")).rejects.toMatchObject({
			status: 404,
			code: "NOT_FOUND",
		});
		expect(prisma.feedLevelLog.findMany).not.toHaveBeenCalled();
	});
});

describe("buildExportRows notifications", () => {
	it("maps acknowledgement fields, including a null acknowledgedAt", async () => {
		const acknowledged = new Date("2026-03-03T00:00:00.000Z");
		prisma.notification.findMany.mockResolvedValue([
			{
				id: "n-1",
				pondId: "pond-1",
				tier: "warning",
				message: "Hopper low",
				linkTo: "/devices/dev-1",
				read: false,
				category: "hopper",
				acknowledgedAt: acknowledged,
				acknowledgedBy: "user-1",
				autoCleared: true,
				createdAt: AT,
			},
			{
				id: "n-2",
				pondId: "pond-1",
				tier: "info",
				message: "Sample due",
				linkTo: null,
				read: true,
				category: null,
				acknowledgedAt: null,
				acknowledgedBy: null,
				autoCleared: false,
				createdAt: AT,
			},
		]);

		const rows = await buildExportRows(CONTEXT, "notifications");

		expect(rows[0]).toEqual({
			id: "n-1",
			pondId: "pond-1",
			tier: "warning",
			message: "Hopper low",
			linkTo: "/devices/dev-1",
			read: false,
			category: "hopper",
			acknowledgedAt: acknowledged.toISOString(),
			acknowledgedBy: "user-1",
			autoCleared: true,
			createdAt: ISO,
		});
		expect(rows[1]).toMatchObject({
			linkTo: null,
			category: null,
			acknowledgedAt: null,
			acknowledgedBy: null,
		});
	});
});

describe("buildExportRows audit_events", () => {
	it("serialises structured metadata so it survives a CSV cell", async () => {
		prisma.deviceStateEvent.findMany.mockResolvedValue([
			{
				id: "ev-1",
				deviceId: "dev-1",
				eventType: "feed_dispensed",
				source: "device",
				actorId: null,
				metadata: { grams: 150, requestId: "req-1" },
				deviceTime: "2026-03-02T04:00:00.000Z",
				createdAt: AT,
			},
		]);

		const [row] = await buildExportRows(CONTEXT, "audit_events");

		expect(row).toEqual({
			id: "ev-1",
			deviceId: "dev-1",
			eventType: "feed_dispensed",
			source: "device",
			actorId: null,
			metadata: JSON.stringify({ grams: 150, requestId: "req-1" }),
			deviceTime: "2026-03-02T04:00:00.000Z",
			createdAt: ISO,
		});
		expect(prisma.deviceStateEvent.findMany).toHaveBeenCalledWith({
			where: { deviceId: { in: ["dev-1", "dev-2"] } },
			orderBy: { createdAt: "asc" },
			take: 50_000,
		});
	});

	it("keeps a null metadata column empty rather than writing the string 'null'", async () => {
		prisma.deviceStateEvent.findMany.mockResolvedValue([
			{
				id: "ev-1",
				deviceId: "dev-1",
				eventType: "connected",
				source: "device",
				actorId: "user-1",
				metadata: null,
				deviceTime: null,
				createdAt: AT,
			},
		]);

		const [row] = await buildExportRows(CONTEXT, "audit_events");

		expect(row.metadata).toBeNull();
	});
});

describe("CSV and batch artifacts", () => {
	it("writes the mapped columns as the CSV header", async () => {
		prisma.feedLevelLog.findMany.mockResolvedValue([
			{ id: "fl-1", deviceId: "dev-1", levelPercent: 62, distanceCm: 18, recordedAt: AT },
		]);

		const artifact = await buildCsvExport("farm-a", "feed_level_logs");
		const text = new TextDecoder().decode(artifact.body);

		expect(artifact.contentType).toBe("text/csv; charset=utf-8");
		expect(text.split(/\r?\n/)[0]).toBe("id,deviceId,levelPercent,distanceCm,recordedAt");
		expect(text).toContain(`${ISO}`);
	});

	it("adds only the types that produced rows to the batch archive", async () => {
		prisma.biomassLog.findMany.mockResolvedValue([
			{
				id: "log-1",
				pondId: "pond-1",
				sampleWeightKg: 1,
				sampleLengthCm: 20,
				sampleCount: 5,
				avgWeightKg: 0.2,
				batchLabel: null,
				recordedAt: AT,
			},
		]);

		const artifact = await buildBatchExport("farm-a", ["biomass_logs", "fcr_reports"]);
		const zip = await JSZip.loadAsync(artifact.body);

		expect(Object.keys(zip.files)).toEqual(["biomass_logs.csv"]);
		expect(artifact.contentType).toBe("application/zip");
		expect(artifact.filename).toMatch(/^pakaonai_export_\d{4}-\d{2}-\d{2}\.zip$/);
	});
});
