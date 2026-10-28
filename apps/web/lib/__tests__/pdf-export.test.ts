import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The PDF report is generated server-side, so two things used to be wrong:
 * it picked an arbitrary pond row (archived ponds included) and it embedded the
 * tenant-controlled pond name in `Content-Disposition` verbatim.
 */

const { db } = vi.hoisted(() => ({
	db: {
		pond: { findMany: vi.fn() },
		energyDevice: { findFirst: vi.fn() },
		biomassLog: { findFirst: vi.fn() },
		fcrReport: { findMany: vi.fn() },
		feedEvent: { findMany: vi.fn() },
		cropCycle: { findFirst: vi.fn() },
	},
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: vi.fn(async () => null),
}));

import { buildPdfExport } from "@/lib/jobs/pdf-export";

function pond(overrides: Record<string, unknown> = {}) {
	return {
		id: "pond-1",
		ownerId: "farm-1",
		status: "ACTIVE",
		name: "Pond A",
		population: 100,
		feedingRatePct: 3,
		feedsPerDay: 2,
		scheduleStart: new Date("2024-01-01T06:00:00Z"),
		scheduleEnd: new Date("2024-01-01T18:00:00Z"),
		sampleIntervalDays: 14,
		isFallow: false,
		createdAt: new Date("2024-01-01T00:00:00Z"),
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	db.pond.findMany.mockResolvedValue([pond()] as never);
	db.energyDevice.findFirst.mockResolvedValue(null as never);
	db.biomassLog.findFirst.mockResolvedValue(null as never);
	db.fcrReport.findMany.mockResolvedValue([] as never);
	db.feedEvent.findMany.mockResolvedValue([] as never);
	db.cropCycle.findFirst.mockResolvedValue(null as never);
});

describe("buildPdfExport", () => {
	it("reports the owner's active pond, ordered like the rest of the app", async () => {
		await buildPdfExport("farm-1");

		expect(db.pond.findMany).toHaveBeenCalledWith({
			where: { ownerId: "farm-1", status: "ACTIVE" },
			orderBy: { createdAt: "asc" },
		});
	});

	it("builds a PDF with a filename that cannot break Content-Disposition", async () => {
		db.pond.findMany.mockResolvedValue([pond({ name: 'Pond "A"\r\nX-Injected: yes' })] as never);

		const artifact = await buildPdfExport("farm-1");

		expect(artifact.contentType).toBe("application/pdf");
		expect(artifact.filename).toMatch(/^pakaonai-report-[A-Za-z0-9._-]+-\d{4}-\d{2}-\d{2}\.pdf$/);
		expect(artifact.filename).not.toMatch(/["\r\n]/);
		expect(new TextDecoder().decode(new Uint8Array(artifact.body).slice(0, 4))).toBe("%PDF");
	});

	it("404s when the farm has no active pond instead of exporting an archived one", async () => {
		db.pond.findMany.mockResolvedValue([] as never);

		await expect(buildPdfExport("farm-1")).rejects.toMatchObject({ status: 404 });
	});
});
