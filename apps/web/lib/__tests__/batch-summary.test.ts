import { describe, expect, it } from "vitest";

import { type BatchLogRow, summarizeBatches } from "@/lib/batch-summary";

function row(overrides: Partial<BatchLogRow>): BatchLogRow {
	return {
		batchLabel: "Batch A",
		sampleCount: 2,
		sampleWeightKg: 0.44,
		recordedAt: new Date("2026-10-01T08:00:00Z"),
		...overrides,
	};
}

describe("summarizeBatches", () => {
	it("returns an empty array for no rows", () => {
		expect(summarizeBatches([])).toEqual([]);
	});

	it("groups rows by batch label with counts and totals", () => {
		const summaries = summarizeBatches([
			row({ batchLabel: "Batch A", recordedAt: new Date("2026-10-01T08:00:00Z") }),
			row({
				batchLabel: "Batch A",
				sampleCount: 3,
				sampleWeightKg: 0.66,
				recordedAt: new Date("2026-10-16T08:00:00Z"),
			}),
			row({ batchLabel: "Batch B", recordedAt: new Date("2026-10-10T08:00:00Z") }),
		]);

		expect(summaries).toHaveLength(2);

		// Batch A saved last on Oct 16 → sorted first.
		const a = summaries[0];
		expect(a.label).toBe("Batch A");
		expect(a.entryCount).toBe(2);
		expect(a.totalSampleCount).toBe(5);
		expect(a.totalWeightKg).toBeCloseTo(1.1, 3);
		expect(a.avgWeightKg).toBeCloseTo(0.22, 3);
		expect(a.lastSavedAt.toISOString()).toBe("2026-10-16T08:00:00.000Z");

		const b = summaries[1];
		expect(b.label).toBe("Batch B");
		expect(b.entryCount).toBe(1);
		expect(b.avgWeightKg).toBeCloseTo(0.22, 3);
	});

	it("puts null labels in a single Unlabeled group", () => {
		const summaries = summarizeBatches([
			row({ batchLabel: null }),
			row({ batchLabel: null, recordedAt: new Date("2026-10-02T08:00:00Z") }),
			row({ batchLabel: "Batch A" }),
		]);

		expect(summaries).toHaveLength(2);
		const unlabeled = summaries.find((s) => s.label === null);
		expect(unlabeled).toBeDefined();
		expect(unlabeled?.entryCount).toBe(2);
	});

	it("sorts batches newest-first by last saved date", () => {
		const summaries = summarizeBatches([
			row({ batchLabel: "Old", recordedAt: new Date("2026-01-01T00:00:00Z") }),
			row({ batchLabel: "New", recordedAt: new Date("2026-12-01T00:00:00Z") }),
			row({ batchLabel: "Mid", recordedAt: new Date("2026-06-01T00:00:00Z") }),
		]);

		expect(summaries.map((s) => s.label)).toEqual(["New", "Mid", "Old"]);
	});

	it("computes avgWeightKg as 0 when total samples is 0", () => {
		const summaries = summarizeBatches([
			row({ batchLabel: "A", sampleCount: 0, sampleWeightKg: 0 }),
		]);
		expect(summaries[0].avgWeightKg).toBe(0);
	});
});
