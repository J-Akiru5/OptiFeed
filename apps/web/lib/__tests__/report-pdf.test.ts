import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The growth, SGR and FCR PDF reports (I-107) draw their own chart, so the
 * guards here are the edge cases a chart can trip on: no data, one point, a flat
 * series, and a pond that does not exist.
 */

const { db } = vi.hoisted(() => ({
	db: {
		pond: { findMany: vi.fn() },
		biomassLog: { findMany: vi.fn() },
		fcrReport: { findMany: vi.fn() },
	},
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: vi.fn(async () => null),
}));

import { buildReportPdf } from "@/lib/jobs/report-pdf";

function pond(overrides: Record<string, unknown> = {}) {
	return {
		id: "pond-1",
		ownerId: "farm-1",
		status: "ACTIVE",
		name: "Pond A",
		createdAt: new Date("2024-01-01T00:00:00Z"),
		...overrides,
	};
}

function sampling(day: number, avgWeightKg: number) {
	return {
		id: `log-${day}`,
		pondId: "pond-1",
		recordedAt: new Date(Date.UTC(2026, 2, day, 4)),
		avgWeightKg,
		sampleCount: 10,
		batchLabel: null,
	};
}

function fcr(day: number, fcrValue: number) {
	return {
		id: `fcr-${day}`,
		pondId: "pond-1",
		periodStart: new Date(Date.UTC(2026, 2, day)),
		periodEnd: new Date(Date.UTC(2026, 2, day + 6)),
		totalFeedKg: 12.5,
		biomassGainKg: 8,
		fcrValue,
	};
}

function isPdf(body: ArrayBuffer) {
	return new TextDecoder().decode(new Uint8Array(body).slice(0, 4)) === "%PDF";
}

beforeEach(() => {
	vi.clearAllMocks();
	db.pond.findMany.mockResolvedValue([pond()] as never);
	db.biomassLog.findMany.mockResolvedValue([] as never);
	db.fcrReport.findMany.mockResolvedValue([] as never);
});

describe("buildReportPdf", () => {
	it("builds a growth report from the samplings, oldest first", async () => {
		db.biomassLog.findMany.mockResolvedValue([
			sampling(15, 0.2),
			sampling(8, 0.1),
			sampling(1, 0.05),
		] as never);

		const artifact = await buildReportPdf("farm-1", "growth");

		expect(artifact.contentType).toBe("application/pdf");
		expect(artifact.filename).toMatch(/^pakaonai-growth-Pond-A-\d{4}-\d{2}-\d{2}\.pdf$/);
		expect(isPdf(artifact.body)).toBe(true);
		expect(db.biomassLog.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { pondId: "pond-1" }, orderBy: { recordedAt: "desc" } }),
		);
	});

	it("builds an SGR report across several samplings", async () => {
		db.biomassLog.findMany.mockResolvedValue([
			sampling(15, 0.3),
			sampling(8, 0.2),
			sampling(1, 0.1),
		] as never);

		const artifact = await buildReportPdf("farm-1", "sgr");

		expect(artifact.filename).toMatch(/^pakaonai-sgr-/);
		expect(isPdf(artifact.body)).toBe(true);
	});

	it("builds an FCR report, including a flat series", async () => {
		db.fcrReport.findMany.mockResolvedValue([fcr(15, 1.6), fcr(8, 1.6), fcr(1, 1.6)] as never);

		const artifact = await buildReportPdf("farm-1", "fcr");

		expect(artifact.filename).toMatch(/^pakaonai-fcr-/);
		expect(isPdf(artifact.body)).toBe(true);
	});

	it("still produces a document when there is nothing to report yet", async () => {
		for (const kind of ["growth", "sgr", "fcr"] as const) {
			const artifact = await buildReportPdf("farm-1", kind);
			expect(isPdf(artifact.body)).toBe(true);
		}
	});

	it("handles a single sampling, where SGR cannot be calculated", async () => {
		db.biomassLog.findMany.mockResolvedValue([sampling(1, 0.1)] as never);

		const artifact = await buildReportPdf("farm-1", "sgr");

		expect(isPdf(artifact.body)).toBe(true);
	});

	it("keeps a tenant-controlled pond name out of the filename", async () => {
		db.pond.findMany.mockResolvedValue([pond({ name: 'Pond "A"\r\nX-Injected: yes' })] as never);

		const artifact = await buildReportPdf("farm-1", "growth");

		expect(artifact.filename).not.toMatch(/["\r\n ]/);
	});

	it("404s when the farm has no active pond", async () => {
		db.pond.findMany.mockResolvedValue([] as never);

		await expect(buildReportPdf("farm-1", "growth")).rejects.toMatchObject({ status: 404 });
	});
});
