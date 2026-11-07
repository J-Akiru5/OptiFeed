import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SAMPLE_INTERVAL_DAYS, resolveSampleIntervalDays } from "@/lib/crop-cycle/sampling";
import { describe, expect, it } from "vitest";

/**
 * #886: the biomass batch summary must state the sampling rate, and the number
 * it shows has to be the one the calendar/reminder scheduler works to — not a
 * sentence that can drift from the code.
 */

const webRoot = join(__dirname, "../..");

describe("sampling interval resolution (#886)", () => {
	it("uses the pond's own cadence", () => {
		expect(resolveSampleIntervalDays(30)).toBe(30);
	});

	it("rounds to whole days, matching the reminder scheduler", () => {
		expect(resolveSampleIntervalDays(7.6)).toBe(8);
	});

	it("falls back to the Prisma default when the value is missing or invalid", () => {
		expect(DEFAULT_SAMPLE_INTERVAL_DAYS).toBe(14);
		expect(resolveSampleIntervalDays(null)).toBe(14);
		expect(resolveSampleIntervalDays(undefined)).toBe(14);
		expect(resolveSampleIntervalDays(0)).toBe(14);
		expect(resolveSampleIntervalDays(Number.NaN)).toBe(14);
	});
});

describe("sampling interval wiring (#886)", () => {
	it("feeds the batch summary, the calendar schedule and the reminder scheduler", () => {
		const batchPage = readFileSync(
			join(webRoot, "app/[locale]/(dashboard)/dashboard/log-sample/batches/page.tsx"),
			"utf8",
		);
		expect(batchPage).toContain("resolveSampleIntervalDays(pond.sampleIntervalDays)");
		expect(batchPage).toContain('t("batchSamplingIntervalValue", { days: samplingIntervalDays })');

		const calendar = readFileSync(join(webRoot, "lib/calendar/event-sources.ts"), "utf8");
		expect(calendar).toContain("resolveSampleIntervalDays(pond.sampleIntervalDays)");

		const reminders = readFileSync(join(webRoot, "lib/crop-cycle/reminders.ts"), "utf8");
		expect(reminders).toContain("resolveSampleIntervalDays(input.sampleIntervalDays)");
	});
});
