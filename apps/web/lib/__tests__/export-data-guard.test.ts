import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A farm with no pond is an empty state, not a server fault. The export
 * endpoints used to throw a plain Error, which the API envelope maps to a 500.
 */

const { resolveActivePond } = vi.hoisted(() => ({ resolveActivePond: vi.fn() }));

vi.mock("@/lib/auth/pond-access", () => ({ resolveActivePond }));
vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findMany: vi.fn() },
		biomassLog: { findMany: vi.fn() },
		fishSample: { findMany: vi.fn() },
		feedEvent: { findMany: vi.fn() },
		fcrReport: { findMany: vi.fn() },
		feedLevelLog: { findMany: vi.fn() },
		notification: { findMany: vi.fn() },
		deviceStateEvent: { findMany: vi.fn() },
	},
}));

import { ApiError } from "@/lib/api/errors";
import { buildBatchExport, buildCsvExport, loadExportContext } from "@/lib/jobs/export-data";
import prisma from "@/lib/prisma";

beforeEach(() => {
	vi.clearAllMocks();
	resolveActivePond.mockResolvedValue(null);
});

describe("export data guards", () => {
	it("reports a missing pond as 404, not an internal error", async () => {
		const error = await loadExportContext("farm-a").catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ApiError);
		expect((error as ApiError).status).toBe(404);
		expect((error as ApiError).code).toBe("NOT_FOUND");
	});

	it("keeps the same status for the CSV and batch entry points", async () => {
		await expect(buildCsvExport("farm-a", "biomass_logs")).rejects.toMatchObject({
			status: 404,
		});
		await expect(buildBatchExport("farm-a", ["biomass_logs"])).rejects.toMatchObject({
			status: 404,
		});
	});
});

describe("export filenames", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resolveActivePond.mockResolvedValue({ id: "pond-1" } as never);
		vi.mocked(prisma.energyDevice.findMany).mockResolvedValue([{ id: "dev-1" }] as never);
		vi.mocked(prisma.biomassLog.findMany).mockResolvedValue([] as never);
		vi.mocked(prisma.fishSample.findMany).mockResolvedValue([] as never);
		vi.mocked(prisma.feedEvent.findMany).mockResolvedValue([] as never);
		vi.mocked(prisma.fcrReport.findMany).mockResolvedValue([] as never);
		vi.mocked(prisma.feedLevelLog.findMany).mockResolvedValue([] as never);
		vi.mocked(prisma.notification.findMany).mockResolvedValue([] as never);
		vi.mocked(prisma.deviceStateEvent.findMany).mockResolvedValue([] as never);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("dates a CSV export by the farm calendar day, not the UTC day", async () => {
		// 23:30 UTC on 10-27 is 07:30 on 10-28 in Asia/Manila.
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-27T23:30:00.000Z"));

		const artifact = await buildCsvExport("farm-a", "biomass_logs");

		expect(artifact.filename).toBe("optifeed_biomass_logs_2026-10-28.csv");
	});

	it("dates a batch export the same way", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-27T23:30:00.000Z"));

		const artifact = await buildBatchExport("farm-a", ["biomass_logs"]);

		expect(artifact.filename).toBe("pakaonai_export_2026-10-28.zip");
	});
});
