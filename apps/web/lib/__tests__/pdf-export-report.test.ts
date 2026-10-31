import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The PDF is a tenant's downloadable record, so the table bodies are asserted
 * rather than the PDF bytes: the pond summary must show the schedule the feeder
 * actually runs, the feed table must label a daily-total import and an unknown
 * source honestly, and a farm with no data must still produce a valid report.
 */

const { db, resolveCurrentSchedule } = vi.hoisted(() => ({
	db: {
		energyDevice: { findFirst: vi.fn() },
		biomassLog: { findFirst: vi.fn() },
		fcrReport: { findMany: vi.fn() },
		feedEvent: { findMany: vi.fn() },
	},
	resolveCurrentSchedule: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/schedule/resolve-current", () => ({ resolveCurrentSchedule }));
vi.mock("jspdf-autotable", () => ({ default: vi.fn() }));

import { resolveActivePond } from "@/lib/auth/pond-access";
import { buildPdfExport } from "@/lib/jobs/pdf-export";
import autoTable from "jspdf-autotable";

vi.mock("@/lib/auth/pond-access", () => ({ resolveActivePond: vi.fn() }));

const mockPond = vi.mocked(resolveActivePond);
const mockTable = vi.mocked(autoTable);

const POND = {
	id: "pond-1",
	name: "Pond A",
	population: 100 as number | null,
	feedingRatePct: 3,
	feedsPerDay: 2,
	scheduleStart: new Date("2024-01-01T06:00:00Z"),
	scheduleEnd: new Date("2024-01-01T18:00:00Z"),
	sampleIntervalDays: 14 as number | null,
};

type TableCall = { body: string[][]; head: string[][] };

function tables(): TableCall[] {
	return mockTable.mock.calls.map((call) => {
		const options = call[1] as { body: string[][]; head: string[][] };
		return { body: options.body, head: options.head };
	});
}

function row(body: string[][], label: string): string[] | undefined {
	return body.find((cells) => cells[0] === label);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockPond.mockResolvedValue(POND as never);
	resolveCurrentSchedule.mockResolvedValue(null);
	db.energyDevice.findFirst.mockResolvedValue({ id: "dev-1", gramsPerFeeding: 120 });
	db.biomassLog.findFirst.mockResolvedValue({
		recordedAt: new Date("2026-03-02T00:00:00.000Z"),
		avgWeightKg: 0.1,
		sampleCount: 20,
	});
	db.fcrReport.findMany.mockResolvedValue([]);
	db.feedEvent.findMany.mockResolvedValue([]);
});

describe("pond summary", () => {
	it("shows the pond columns and the volume implied by the latest sample", async () => {
		await buildPdfExport("farm-1");

		const body = tables()[0].body;
		expect(row(body, "Pond Name")).toEqual(["Pond Name", "Pond A"]);
		expect(row(body, "Schedule")).toEqual(["Schedule", "6:00 - 18:00"]);
		expect(row(body, "Feeds Per Day")).toEqual(["Feeds Per Day", "2"]);
		expect(row(body, "Feeding Rate")).toEqual(["Feeding Rate", "3%"]);
		// 100 fish × 0.1 kg = 10,000 g biomass; 3% ÷ 2 meals = 150 g.
		expect(row(body, "Feed Volume")).toEqual(["Feed Volume", "150 g"]);
		expect(row(body, "Population")).toEqual(["Population", "100"]);
		expect(row(body, "Sample Interval")).toEqual(["Sample Interval", "14 days"]);
	});

	it("prefers the resolved schedule over the pond columns", async () => {
		resolveCurrentSchedule.mockResolvedValue({
			feedsPerDay: 4,
			feedingRatePct: 5,
			scheduleStart: new Date("2024-01-01T05:00:00Z"),
			scheduleEnd: new Date("2024-01-01T19:00:00Z"),
		});

		await buildPdfExport("farm-1");

		expect(resolveCurrentSchedule).toHaveBeenCalledWith("pond-1", "dev-1");
		const body = tables()[0].body;
		expect(row(body, "Schedule")).toEqual(["Schedule", "5:00 - 19:00"]);
		expect(row(body, "Feeds Per Day")).toEqual(["Feeds Per Day", "4"]);
		expect(row(body, "Feeding Rate")).toEqual(["Feeding Rate", "5%"]);
		// 10,000 g × 5% ÷ 4 meals = 125 g.
		expect(row(body, "Feed Volume")).toEqual(["Feed Volume", "125 g"]);
	});

	it("falls back to the device value when the volume cannot be calculated", async () => {
		mockPond.mockResolvedValue({ ...POND, population: null } as never);

		await buildPdfExport("farm-1");

		expect(row(tables()[0].body, "Feed Volume")).toEqual(["Feed Volume", "120 g"]);
		expect(row(tables()[0].body, "Population")).toEqual(["Population", "Not set"]);
	});

	it("asks for a fish count when there is neither a calculation nor a device value", async () => {
		mockPond.mockResolvedValue({ ...POND, population: null } as never);
		db.energyDevice.findFirst.mockResolvedValue(null);

		await buildPdfExport("farm-1");

		expect(row(tables()[0].body, "Feed Volume")).toEqual(["Feed Volume", "Set fish count"]);
	});

	it("falls back to the device value when there is no biomass sample", async () => {
		db.biomassLog.findFirst.mockResolvedValue(null);

		await buildPdfExport("farm-1");

		expect(row(tables()[0].body, "Feed Volume")).toEqual(["Feed Volume", "120 g"]);
	});

	it("defaults the sample interval to 14 days", async () => {
		mockPond.mockResolvedValue({ ...POND, sampleIntervalDays: null } as never);

		await buildPdfExport("farm-1");

		expect(row(tables()[0].body, "Sample Interval")).toEqual(["Sample Interval", "14 days"]);
	});
});

describe("record tables", () => {
	it("prints the latest biomass sample in grams", async () => {
		await buildPdfExport("farm-1");

		const biomass = tables().find((table) => table.head[0][0] === "Date");
		expect(biomass?.body).toEqual([["Mar 2, 2026", "100.0", "20", ""]]);
	});

	it("formats FCR periods, values and missing figures", async () => {
		db.fcrReport.findMany.mockResolvedValue([
			{
				periodStart: new Date("2026-03-01T00:00:00.000Z"),
				periodEnd: new Date("2026-03-31T00:00:00.000Z"),
				fcrValue: 1.6,
				totalFeedKg: 400,
				biomassGainKg: 250,
			},
			{
				periodStart: new Date("2026-02-01T00:00:00.000Z"),
				periodEnd: new Date("2026-02-28T00:00:00.000Z"),
				fcrValue: 2,
				totalFeedKg: null,
				biomassGainKg: null,
			},
		]);

		await buildPdfExport("farm-1");

		const fcr = tables().find((table) => table.head[0][0] === "Period");
		expect(fcr?.body).toEqual([
			["Mar 1, 2026 - Mar 31, 2026", "1.60", "400.0", "250.0"],
			["Feb 1, 2026 - Feb 28, 2026", "2.00", "—", "—"],
		]);
	});

	it("labels a hand-fed daily total and an unreported source", async () => {
		db.feedEvent.findMany.mockResolvedValue([
			{ receivedAt: new Date("2026-03-02T04:00:00.000Z"), grams: 150, source: "hand_fed" },
			{ receivedAt: new Date("2026-03-02T05:00:00.000Z"), grams: 1200, source: "schedule" },
			{ receivedAt: new Date("2026-03-02T06:00:00.000Z"), grams: null, source: null },
		]);

		await buildPdfExport("farm-1");

		const events = tables().find((table) => table.head[0][0] === "Time");
		expect(events?.body.map((cells) => cells.slice(1))).toEqual([
			["150 g", "Hand-fed (daily total)"],
			["1.20 kg", "schedule"],
			["0 g", "Not reported"],
		]);
		expect(db.feedEvent.findMany).toHaveBeenCalledWith({
			where: { deviceId: "dev-1", eventType: "feed_dispensed" },
			orderBy: { receivedAt: "desc" },
			take: 50,
		});
	});

	it("prints at most twenty feedings even when more were loaded", async () => {
		db.feedEvent.findMany.mockResolvedValue(
			Array.from({ length: 50 }, (_, index) => ({
				receivedAt: new Date("2026-03-02T04:00:00.000Z"),
				grams: index + 1,
				source: "schedule",
			})),
		);

		await buildPdfExport("farm-1");

		const events = tables().find((table) => table.head[0][0] === "Time");
		expect(events?.body).toHaveLength(20);
	});
});

describe("a farm with no records", () => {
	beforeEach(() => {
		db.energyDevice.findFirst.mockResolvedValue(null);
		db.biomassLog.findFirst.mockResolvedValue(null);
	});

	it("still produces a report with only the pond summary", async () => {
		const artifact = await buildPdfExport("farm-1");

		expect(tables()).toHaveLength(1);
		expect(new TextDecoder().decode(new Uint8Array(artifact.body).slice(0, 4))).toBe("%PDF");
		// With no device there is nothing to query feed events for.
		expect(db.feedEvent.findMany).not.toHaveBeenCalled();
		expect(resolveCurrentSchedule).toHaveBeenCalledWith("pond-1", null);
	});
});

describe("report filename", () => {
	it("falls back to 'pond' when the name has no safe characters", async () => {
		mockPond.mockResolvedValue({ ...POND, name: "…" } as never);

		const artifact = await buildPdfExport("farm-1");

		expect(artifact.filename).toMatch(/^pakaonai-report-pond-\d{4}-\d{2}-\d{2}\.pdf$/);
	});

	it("caps a long pond name at 60 characters", async () => {
		mockPond.mockResolvedValue({ ...POND, name: "a".repeat(120) } as never);

		const artifact = await buildPdfExport("farm-1");

		const name = artifact.filename
			.replace(/^pakaonai-report-/, "")
			.replace(/-\d{4}-\d{2}-\d{2}\.pdf$/, "");
		expect(name).toHaveLength(60);
	});
});
