import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { addDays, todayDateOnly } from "../crop-cycle/dates";
import {
	cancelCycleSchema,
	completePondEventSchema,
	cropCycleInputSchema,
	deletePondEventSchema,
	harvestInputSchema,
	manualEventTypes,
	pondEventInputSchema,
	updatePondEventSchema,
} from "../crop-cycle/schema";

function messagesAt(error: z.ZodError, path: string): string[] {
	return error.issues
		.filter((issue) => issue.path.join(".") === path)
		.map((issue) => issue.message);
}

function firstMessage(error: z.ZodError): string {
	return error.issues[0]?.message ?? "";
}

/** A valid create payload with dates relative to the real farm "today". */
function validCycle(overrides: Record<string, unknown> = {}) {
	const today = todayDateOnly();
	const stockingDate = addDays(today, -30);
	return {
		pondId: "pond-1",
		label: "Batch 2026-10",
		stockingDate,
		stockingCount: 1000,
		stockingAvgWeightG: 50,
		growOutDays: 135,
		targetHarvestDate: addDays(stockingDate, 135),
		targetHarvestWeightG: 250,
		expectedSurvivalPct: 85,
		notes: null,
		...overrides,
	};
}

function validHarvest(overrides: Record<string, unknown> = {}) {
	return {
		pondId: "pond-1",
		cycleId: "cycle-1",
		actualHarvestDate: todayDateOnly(),
		actualHarvestWeightKg: 150,
		actualHarvestCount: 950,
		actualFcr: null,
		notes: null,
		...overrides,
	};
}

describe("cropCycleInputSchema", () => {
	it("accepts a valid create payload and strips empty optional text", () => {
		const parsed = cropCycleInputSchema.safeParse(
			validCycle({ label: "  Batch 2026-10  ", notes: "   " }),
		);
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		expect(parsed.data.label).toBe("Batch 2026-10");
		expect(parsed.data.notes).toBeNull();
		expect(parsed.data.stockingCount).toBe(1000);
		expect(parsed.data.growOutDays).toBe(135);
	});

	it("accepts omitted optional fields", () => {
		const parsed = cropCycleInputSchema.safeParse(
			validCycle({
				label: undefined,
				stockingAvgWeightG: undefined,
				targetHarvestWeightG: undefined,
				expectedSurvivalPct: undefined,
				notes: undefined,
			}),
		);
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		expect(parsed.data.stockingAvgWeightG).toBeUndefined();
		expect(parsed.data.targetHarvestWeightG).toBeUndefined();
		expect(parsed.data.expectedSurvivalPct).toBeUndefined();
		expect(parsed.data.label).toBeNull();
	});

	it("requires a pond", () => {
		const result = cropCycleInputSchema.safeParse(validCycle({ pondId: "" }));
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(messagesAt(result.error, "pondId")).toEqual(["Choose a pond"]);
	});

	it("rejects a harvest date less than 30 days after stocking", () => {
		const result = cropCycleInputSchema.safeParse(
			validCycle({ targetHarvestDate: addDays(validCycle().stockingDate, 29) }),
		);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(messagesAt(result.error, "targetHarvestDate")).toEqual([
			"Harvest date must be at least 30 days after stocking",
		]);
	});

	it("accepts the 30-day boundary", () => {
		const result = cropCycleInputSchema.safeParse(
			validCycle({ targetHarvestDate: addDays(validCycle().stockingDate, 30) }),
		);
		expect(result.success).toBe(true);
	});

	it("rejects a harvest date more than 365 days after stocking", () => {
		const result = cropCycleInputSchema.safeParse(
			validCycle({ targetHarvestDate: addDays(validCycle().stockingDate, 366) }),
		);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(messagesAt(result.error, "targetHarvestDate")).toEqual([
			"Harvest date cannot be more than 365 days after stocking",
		]);
	});

	it("accepts the 365-day boundary", () => {
		const result = cropCycleInputSchema.safeParse(
			validCycle({ targetHarvestDate: addDays(validCycle().stockingDate, 365) }),
		);
		expect(result.success).toBe(true);
	});

	it("rejects a stocking date more than 7 days in the future", () => {
		const stockingDate = addDays(todayDateOnly(), 8);
		const result = cropCycleInputSchema.safeParse(
			validCycle({ stockingDate, targetHarvestDate: addDays(stockingDate, 135) }),
		);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(messagesAt(result.error, "stockingDate")).toEqual([
			"Stocking date cannot be more than 7 days in the future",
		]);
	});

	it("accepts today and exactly 7 days ahead as stocking dates", () => {
		const today = todayDateOnly();
		for (const stockingDate of [today, addDays(today, 7)]) {
			const result = cropCycleInputSchema.safeParse(
				validCycle({ stockingDate, targetHarvestDate: addDays(stockingDate, 135) }),
			);
			expect(result.success).toBe(true);
		}
	});

	// Regression guard: an impossible date must return a normal Zod failure,
	// not throw from a superRefine cross-field check.
	it("rejects impossible calendar dates without throwing", () => {
		const result = cropCycleInputSchema.safeParse(validCycle({ stockingDate: "2026-02-30" }));
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(messagesAt(result.error, "stockingDate")).toEqual([
			"Use a valid date in YYYY-MM-DD format",
		]);
	});

	it("enforces the grow-out period range and whole days", () => {
		const cases: Array<{ growOutDays: unknown; message: string }> = [
			{ growOutDays: 29, message: "Grow-out period must be at least 30 days" },
			{ growOutDays: 366, message: "Grow-out period cannot exceed 365 days" },
			{ growOutDays: 135.5, message: "Grow-out days must be a whole number" },
			{ growOutDays: "135", message: "Grow-out days must be a number" },
		];
		for (const { growOutDays, message } of cases) {
			const result = cropCycleInputSchema.safeParse(validCycle({ growOutDays }));
			expect(result.success).toBe(false);
			if (result.success) continue;
			expect(messagesAt(result.error, "growOutDays")).toEqual([message]);
		}
	});

	it("accepts the grow-out period boundaries", () => {
		expect(cropCycleInputSchema.safeParse(validCycle({ growOutDays: 30 })).success).toBe(true);
		expect(cropCycleInputSchema.safeParse(validCycle({ growOutDays: 365 })).success).toBe(true);
	});

	it("enforces the stocking count range and whole fish", () => {
		const cases: Array<{ value: unknown; message: string }> = [
			{ value: 0, message: "Stocking count must be at least 1" },
			{ value: -5, message: "Stocking count must be at least 1" },
			{ value: 1_000_001, message: "Stocking count is too large" },
			{ value: 1.5, message: "Stocking count must be a whole number" },
			{ value: "1000", message: "Stocking count must be a number" },
		];
		for (const { value, message } of cases) {
			const result = cropCycleInputSchema.safeParse(validCycle({ stockingCount: value }));
			expect(result.success).toBe(false);
			if (result.success) continue;
			expect(messagesAt(result.error, "stockingCount")).toEqual([message]);
		}
		expect(cropCycleInputSchema.safeParse(validCycle({ stockingCount: 1 })).success).toBe(true);
		expect(cropCycleInputSchema.safeParse(validCycle({ stockingCount: 1_000_000 })).success).toBe(
			true,
		);
	});

	it("enforces stocking and target weight ranges", () => {
		const badStocking = cropCycleInputSchema.safeParse(validCycle({ stockingAvgWeightG: 0 }));
		expect(badStocking.success).toBe(false);
		if (!badStocking.success) {
			expect(messagesAt(badStocking.error, "stockingAvgWeightG")).toEqual([
				"Stocking weight must be greater than 0",
			]);
		}

		const bigStocking = cropCycleInputSchema.safeParse(validCycle({ stockingAvgWeightG: 10_001 }));
		expect(bigStocking.success).toBe(false);
		if (!bigStocking.success) {
			expect(messagesAt(bigStocking.error, "stockingAvgWeightG")).toEqual([
				"Stocking weight is too large",
			]);
		}

		const badTarget = cropCycleInputSchema.safeParse(validCycle({ targetHarvestWeightG: 0 }));
		expect(badTarget.success).toBe(false);
		if (!badTarget.success) {
			expect(messagesAt(badTarget.error, "targetHarvestWeightG")).toEqual([
				"Target weight must be greater than 0",
			]);
		}

		const bigTarget = cropCycleInputSchema.safeParse(validCycle({ targetHarvestWeightG: 10_001 }));
		expect(bigTarget.success).toBe(false);
		if (!bigTarget.success) {
			expect(messagesAt(bigTarget.error, "targetHarvestWeightG")).toEqual([
				"Target weight is too large",
			]);
		}

		expect(
			cropCycleInputSchema.safeParse(validCycle({ targetHarvestWeightG: 10_000 })).success,
		).toBe(true);
	});

	it("enforces the expected survival percentage range", () => {
		const low = cropCycleInputSchema.safeParse(validCycle({ expectedSurvivalPct: 0 }));
		expect(low.success).toBe(false);
		if (!low.success) {
			expect(messagesAt(low.error, "expectedSurvivalPct")).toEqual([
				"Survival must be at least 1%",
			]);
		}

		const high = cropCycleInputSchema.safeParse(validCycle({ expectedSurvivalPct: 101 }));
		expect(high.success).toBe(false);
		if (!high.success) {
			expect(messagesAt(high.error, "expectedSurvivalPct")).toEqual([
				"Survival cannot exceed 100%",
			]);
		}

		expect(cropCycleInputSchema.safeParse(validCycle({ expectedSurvivalPct: 1 })).success).toBe(
			true,
		);
		expect(cropCycleInputSchema.safeParse(validCycle({ expectedSurvivalPct: 100 })).success).toBe(
			true,
		);
	});

	it("caps the label and notes length", () => {
		const label = cropCycleInputSchema.safeParse(validCycle({ label: "x".repeat(65) }));
		expect(label.success).toBe(false);
		if (!label.success) {
			expect(messagesAt(label.error, "label")).toEqual([
				"Too big: expected string to have <=64 characters",
			]);
		}
		expect(cropCycleInputSchema.safeParse(validCycle({ label: "x".repeat(64) })).success).toBe(
			true,
		);

		const notes = cropCycleInputSchema.safeParse(validCycle({ notes: "x".repeat(1_001) }));
		expect(notes.success).toBe(false);
		if (!notes.success) {
			expect(firstMessage(notes.error)).toContain("<=");
		}
		expect(cropCycleInputSchema.safeParse(validCycle({ notes: "x".repeat(1_000) })).success).toBe(
			true,
		);
	});
});

describe("harvestInputSchema", () => {
	it("accepts a valid harvest payload", () => {
		const parsed = harvestInputSchema.safeParse(validHarvest());
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		expect(parsed.data.actualHarvestWeightKg).toBe(150);
		expect(parsed.data.actualFcr).toBeNull();
	});

	it("rejects a future harvest date", () => {
		const result = harvestInputSchema.safeParse(
			validHarvest({ actualHarvestDate: addDays(todayDateOnly(), 1) }),
		);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(messagesAt(result.error, "actualHarvestDate")).toEqual([
			"Harvest date cannot be in the future",
		]);
	});

	// KNOWN BUG: `harvestInputSchema.superRefine` (schema.ts:96-104) calls
	// `daysBetween()` before confirming the date is valid, so `safeParse`
	// throws a RangeError for an impossible date instead of returning issues.
	it("rejects an impossible harvest date without throwing", () => {
		const result = harvestInputSchema.safeParse(validHarvest({ actualHarvestDate: "2026-02-30" }));
		expect(result.success).toBe(false);
	});

	it("rejects a non-positive harvest weight", () => {
		for (const weight of [0, -10]) {
			const result = harvestInputSchema.safeParse(validHarvest({ actualHarvestWeightKg: weight }));
			expect(result.success).toBe(false);
			if (result.success) continue;
			expect(messagesAt(result.error, "actualHarvestWeightKg")).toEqual([
				"Harvest weight must be greater than 0",
			]);
		}
	});

	it("rejects a negative count and accepts zero", () => {
		const negative = harvestInputSchema.safeParse(validHarvest({ actualHarvestCount: -1 }));
		expect(negative.success).toBe(false);
		if (!negative.success) {
			expect(messagesAt(negative.error, "actualHarvestCount")).toEqual([
				"Harvest count cannot be negative",
			]);
		}
		expect(harvestInputSchema.safeParse(validHarvest({ actualHarvestCount: 0 })).success).toBe(
			true,
		);
	});

	it("rejects a fractional count", () => {
		const result = harvestInputSchema.safeParse(validHarvest({ actualHarvestCount: 10.5 }));
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(messagesAt(result.error, "actualHarvestCount")).toEqual([
			"Harvest count must be a whole number",
		]);
	});

	it("enforces the FCR range", () => {
		const cases: Array<{ value: number; message: string }> = [
			{ value: 0.4, message: "FCR must be at least 0.5" },
			{ value: 10.1, message: "FCR cannot exceed 10" },
		];
		for (const { value, message } of cases) {
			const result = harvestInputSchema.safeParse(validHarvest({ actualFcr: value }));
			expect(result.success).toBe(false);
			if (result.success) continue;
			expect(messagesAt(result.error, "actualFcr")).toEqual([message]);
		}
		expect(harvestInputSchema.safeParse(validHarvest({ actualFcr: 0.5 })).success).toBe(true);
		expect(harvestInputSchema.safeParse(validHarvest({ actualFcr: 10 })).success).toBe(true);
	});

	it("enforces harvest weight and count maximums", () => {
		expect(
			harvestInputSchema.safeParse(validHarvest({ actualHarvestWeightKg: 100_001 })).success,
		).toBe(false);
		expect(
			harvestInputSchema.safeParse(validHarvest({ actualHarvestCount: 1_000_001 })).success,
		).toBe(false);
	});

	it("requires pond and cycle ids", () => {
		expect(harvestInputSchema.safeParse(validHarvest({ pondId: "" })).success).toBe(false);
		expect(harvestInputSchema.safeParse(validHarvest({ cycleId: "" })).success).toBe(false);
	});
});

describe("manual pond event schemas", () => {
	it("accepts maintenance and other manual events", () => {
		expect(manualEventTypes).toEqual(["MAINTENANCE", "OTHER"]);
		for (const type of manualEventTypes) {
			const result = pondEventInputSchema.safeParse({
				pondId: "pond-1",
				type,
				title: "Clean the aerator",
				startsAt: todayDateOnly(),
				notes: null,
			});
			expect(result.success).toBe(true);
		}
	});

	it("rejects cycle-owned event types", () => {
		const result = pondEventInputSchema.safeParse({
			pondId: "pond-1",
			type: "STOCKING",
			title: "Stocked",
			startsAt: todayDateOnly(),
		});
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.issues.some((issue) => issue.path.join(".") === "type")).toBe(true);
	});

	it("enforces the title length after trimming", () => {
		const empty = pondEventInputSchema.safeParse({
			pondId: "pond-1",
			type: "OTHER",
			title: "   ",
			startsAt: todayDateOnly(),
		});
		expect(empty.success).toBe(false);
		if (!empty.success) {
			expect(messagesAt(empty.error, "title")).toEqual(["Add a title"]);
		}

		const long = pondEventInputSchema.safeParse({
			pondId: "pond-1",
			type: "OTHER",
			title: "x".repeat(81),
			startsAt: todayDateOnly(),
		});
		expect(long.success).toBe(false);
		if (!long.success) {
			expect(messagesAt(long.error, "title")).toEqual(["Title is too long"]);
		}

		expect(
			pondEventInputSchema.safeParse({
				pondId: "pond-1",
				type: "OTHER",
				title: "x".repeat(80),
				startsAt: todayDateOnly(),
			}).success,
		).toBe(true);
	});

	it("rejects an event more than a year in the future but allows history", () => {
		const farFuture = pondEventInputSchema.safeParse({
			pondId: "pond-1",
			type: "MAINTENANCE",
			title: "Service",
			startsAt: addDays(todayDateOnly(), 366),
		});
		expect(farFuture.success).toBe(false);
		if (!farFuture.success) {
			expect(messagesAt(farFuture.error, "startsAt")).toEqual([
				"Event date is too far in the future",
			]);
		}

		expect(
			pondEventInputSchema.safeParse({
				pondId: "pond-1",
				type: "MAINTENANCE",
				title: "Service",
				startsAt: addDays(todayDateOnly(), 365),
			}).success,
		).toBe(true);
		expect(
			pondEventInputSchema.safeParse({
				pondId: "pond-1",
				type: "MAINTENANCE",
				title: "Old service",
				startsAt: addDays(todayDateOnly(), -1_000),
			}).success,
		).toBe(true);
	});

	it("rejects an empty optional cycle id", () => {
		expect(
			pondEventInputSchema.safeParse({
				pondId: "pond-1",
				cropCycleId: "",
				type: "OTHER",
				title: "Event",
				startsAt: todayDateOnly(),
			}).success,
		).toBe(false);
	});

	// KNOWN BUG: the same unguarded `daysBetween()` in
	// `pondEventInputSchema.superRefine` (schema.ts:117-125) makes `safeParse`
	// throw on an impossible date instead of returning a validation error.
	it("rejects an impossible startsAt without throwing", () => {
		const result = pondEventInputSchema.safeParse({
			pondId: "pond-1",
			type: "OTHER",
			title: "Event",
			startsAt: "2026-02-30",
		});
		expect(result.success).toBe(false);
	});

	it("validates manual event updates and caps notes", () => {
		expect(
			updatePondEventSchema.safeParse({
				id: "event-1",
				title: "Rescheduled",
				startsAt: addDays(todayDateOnly(), 10),
			}).success,
		).toBe(true);
		expect(
			updatePondEventSchema.safeParse({
				id: "",
				title: "Rescheduled",
				startsAt: todayDateOnly(),
			}).success,
		).toBe(false);
		expect(
			updatePondEventSchema.safeParse({
				id: "event-1",
				title: "",
				startsAt: todayDateOnly(),
			}).success,
		).toBe(false);
		expect(
			updatePondEventSchema.safeParse({
				id: "event-1",
				title: "x".repeat(81),
				startsAt: todayDateOnly(),
			}).success,
		).toBe(false);
		expect(
			updatePondEventSchema.safeParse({
				id: "event-1",
				title: "Notes",
				startsAt: todayDateOnly(),
				notes: "x".repeat(1_001),
			}).success,
		).toBe(false);
	});

	it("requires an id for complete and delete actions", () => {
		expect(completePondEventSchema.safeParse({ id: "event-1" }).success).toBe(true);
		expect(completePondEventSchema.safeParse({ id: "" }).success).toBe(false);
		expect(deletePondEventSchema.safeParse({ id: "event-1" }).success).toBe(true);
		expect(deletePondEventSchema.safeParse({ id: "" }).success).toBe(false);
	});

	it("validates the cancel-cycle payload", () => {
		const parsed = cancelCycleSchema.safeParse({
			pondId: "pond-1",
			cycleId: "cycle-1",
			notes: "   ",
		});
		expect(parsed.success).toBe(true);
		if (parsed.success) expect(parsed.data.notes).toBeNull();

		expect(cancelCycleSchema.safeParse({ pondId: "", cycleId: "cycle-1" }).success).toBe(false);
		expect(cancelCycleSchema.safeParse({ pondId: "pond-1", cycleId: "" }).success).toBe(false);
	});
});
