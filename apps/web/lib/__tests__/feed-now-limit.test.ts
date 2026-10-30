import { feedNowLimitMessage, formatFeedGrams, resolveFeedNowLimitG } from "@/lib/limits";
import { describe, expect, it } from "vitest";

/**
 * Issue #387 / #398: the daily ceiling is the only gram cap for a manual feed.
 * There is no per-request or per-meal ceiling; the limit is whatever is left of
 * the resolved daily allowance today.
 */
describe("resolveFeedNowLimitG", () => {
	it("uses the whole daily ceiling when nothing has been fed today", () => {
		const limit = resolveFeedNowLimitG({ dailyCapG: 2000, usedTodayG: 0 });

		expect(limit).toEqual({
			effectiveG: 2000,
			dailyCapG: 2000,
			usedTodayG: 0,
			remainingDailyG: 2000,
		});
	});

	it("does not cap a large configured daily ceiling at 1,000 g", () => {
		const limit = resolveFeedNowLimitG({ dailyCapG: 5000, usedTodayG: 0 });

		expect(limit.effectiveG).toBe(5000);
		expect(limit.remainingDailyG).toBe(5000);
	});

	it("lowers the limit to what is left of the daily allowance", () => {
		const limit = resolveFeedNowLimitG({ dailyCapG: 2000, usedTodayG: 1900 });

		expect(limit.effectiveG).toBe(100);
		expect(limit.remainingDailyG).toBe(100);
	});

	it("never returns a negative daily allowance", () => {
		const limit = resolveFeedNowLimitG({ dailyCapG: 2000, usedTodayG: 2500 });

		expect(limit.effectiveG).toBe(0);
		expect(limit.remainingDailyG).toBe(0);
	});

	it("falls back to the standard daily cap for a malformed input", () => {
		const limit = resolveFeedNowLimitG({ dailyCapG: Number.NaN });

		expect(limit.dailyCapG).toBe(2000);
		expect(limit.remainingDailyG).toBe(2000);
	});

	it("ignores a malformed usage figure instead of rejecting the feed", () => {
		const limit = resolveFeedNowLimitG({ dailyCapG: 2000, usedTodayG: Number.NaN });

		expect(limit.usedTodayG).toBe(0);
		expect(limit.effectiveG).toBe(2000);
	});
});

describe("feedNowLimitMessage", () => {
	it("names the remaining grams, the daily ceiling and where to change it", () => {
		const message = feedNowLimitMessage(
			resolveFeedNowLimitG({ dailyCapG: 2000, usedTodayG: 1150 }),
		);

		expect(message).toContain("Feed Now would exceed today's daily ceiling: 850 g left of 2000 g");
		expect(message).toContain("Settings > Pond");
		expect(message).toContain("device daily ceiling");
	});

	it("explains a fully used daily allowance", () => {
		const message = feedNowLimitMessage(
			resolveFeedNowLimitG({ dailyCapG: 2000, usedTodayG: 2000 }),
		);

		expect(message).toContain("0 g left of 2000 g");
	});
});

describe("formatFeedGrams", () => {
	it("shows at most one decimal without a thousands separator", () => {
		expect(formatFeedGrams(1000)).toBe("1000");
		expect(formatFeedGrams(2110.06)).toBe("2110.1");
		expect(formatFeedGrams(400.04)).toBe("400");
	});
});
