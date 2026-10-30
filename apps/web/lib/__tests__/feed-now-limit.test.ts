import {
	MAX_FEED_GRAMS_PER_REQUEST,
	feedNowLimitMessage,
	formatFeedGrams,
	resolveFeedNowLimitG,
} from "@/lib/limits";
import { describe, expect, it } from "vitest";

/**
 * Issue #387 / decision E30: the manual Feed Now ceiling follows the
 * pond/device per-meal dose and the remaining daily allowance, while the
 * 1,000 g request cap stays only as the absolute safety ceiling.
 */
describe("resolveFeedNowLimitG", () => {
	it("uses a lower pond per-meal ceiling", () => {
		const limit = resolveFeedNowLimitG({ perMealG: 400, dailyCapG: 2000, usedTodayG: 0 });

		expect(limit).toEqual({
			effectiveG: 400,
			perMealCeilingG: 400,
			hardCeilingG: MAX_FEED_GRAMS_PER_REQUEST,
			remainingDailyG: 2000,
			source: "pond_per_meal",
		});
	});

	it("never raises the absolute safety ceiling above 1,000 g", () => {
		const limit = resolveFeedNowLimitG({ perMealG: 2110.06, dailyCapG: 5000, usedTodayG: 0 });

		expect(limit.effectiveG).toBe(MAX_FEED_GRAMS_PER_REQUEST);
		expect(limit.perMealCeilingG).toBe(2110.06);
		expect(limit.source).toBe("hard_ceiling");
	});

	it("keeps the hard ceiling when the device has no per-meal value", () => {
		expect(resolveFeedNowLimitG({ perMealG: null, dailyCapG: 2000 }).effectiveG).toBe(1000);
		expect(resolveFeedNowLimitG({ perMealG: 0, dailyCapG: 2000 }).effectiveG).toBe(1000);
	});

	it("lowers the limit to the remaining daily allowance", () => {
		const limit = resolveFeedNowLimitG({ perMealG: 1000, dailyCapG: 2000, usedTodayG: 1900 });

		expect(limit.effectiveG).toBe(100);
		expect(limit.remainingDailyG).toBe(100);
		expect(limit.source).toBe("remaining_daily");
	});

	it("never returns a negative daily allowance", () => {
		const limit = resolveFeedNowLimitG({ perMealG: 500, dailyCapG: 2000, usedTodayG: 2500 });

		expect(limit.effectiveG).toBe(0);
		expect(limit.remainingDailyG).toBe(0);
		expect(limit.source).toBe("remaining_daily");
	});

	it("falls back to the standard daily cap for a malformed input", () => {
		const limit = resolveFeedNowLimitG({ perMealG: 400, dailyCapG: Number.NaN });

		expect(limit.remainingDailyG).toBeGreaterThan(0);
		expect(limit.effectiveG).toBe(400);
	});
});

describe("feedNowLimitMessage", () => {
	it("names the pond setting, the numbers and the remaining daily ceiling", () => {
		const message = feedNowLimitMessage(
			resolveFeedNowLimitG({ perMealG: 400, dailyCapG: 2000, usedTodayG: 1150 }),
		);

		expect(message).toContain("Feed Now limit is 400 g (pond per-meal ceiling)");
		expect(message).toContain("Pond per-meal ceiling: 400 g");
		expect(message).toContain("Absolute safety ceiling: 1000 g");
		expect(message).toContain("Remaining daily ceiling: 850 g");
		expect(message).toContain("Settings > Pond");
	});

	it("explains when the hard ceiling is the binding limit", () => {
		const message = feedNowLimitMessage(
			resolveFeedNowLimitG({ perMealG: 2110.06, dailyCapG: 5000 }),
		);

		expect(message).toContain("absolute safety ceiling");
		expect(message).toContain("2110.1 g");
	});

	it("explains when the daily allowance is the binding limit", () => {
		const message = feedNowLimitMessage(
			resolveFeedNowLimitG({ perMealG: 1000, dailyCapG: 2000, usedTodayG: 1950 }),
		);

		expect(message).toContain("remaining daily ceiling");
		expect(message).toContain("Remaining daily ceiling: 50 g");
	});
});

describe("formatFeedGrams", () => {
	it("shows at most one decimal without a thousands separator", () => {
		expect(formatFeedGrams(1000)).toBe("1000");
		expect(formatFeedGrams(2110.06)).toBe("2110.1");
		expect(formatFeedGrams(400.04)).toBe("400");
	});
});
