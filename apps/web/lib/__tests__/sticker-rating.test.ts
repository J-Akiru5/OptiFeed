import { describe, expect, it } from "vitest";

import {
	LABEL_STICKER_RATING,
	STICKER_RATING_KEY,
	applyStickerRatingParams,
	clearStickerRatingParams,
	computePowerVA,
	isIsoDateString,
	isPowerOverridden,
	normalizeStickerRating,
	parseStickerRatingParams,
	resolveStickerRating,
} from "@/lib/constants/sticker-rating";

const SAVED = {
	voltageV: 230,
	frequencyHz: 60 as const,
	currentA: 1.1,
	powerVA: 253,
	measured: false,
	measuredAt: null,
};

describe("label rating", () => {
	it("is the value from hardware-rating.ts", () => {
		expect(STICKER_RATING_KEY).toBe("sticker.rating");
		expect(LABEL_STICKER_RATING).toEqual({
			voltageV: 220,
			frequencyHz: 60,
			currentA: 1.2,
			powerVA: 264,
			measured: false,
			measuredAt: null,
		});
	});

	it("computes and rounds V × A", () => {
		expect(computePowerVA(220, 1.2)).toBe(264);
		expect(computePowerVA(230, 1.15)).toBe(265);
		expect(computePowerVA(100, 0.1)).toBe(10);
	});

	it("knows when the VA is a hand-entered figure", () => {
		expect(isPowerOverridden(LABEL_STICKER_RATING)).toBe(false);
		expect(isPowerOverridden({ ...LABEL_STICKER_RATING, powerVA: 300 })).toBe(true);
	});
});

describe("URL params", () => {
	it("reads a complete override", () => {
		expect(
			parseStickerRatingParams({
				voltage: "230",
				hz: "50",
				amps: "1.1",
				va: "300",
				measured: "1",
				measuredAt: "2026-10-27",
			}),
		).toEqual({
			voltageV: 230,
			frequencyHz: 50,
			currentA: 1.1,
			powerVA: 300,
			measured: true,
			measuredAt: "2026-10-27",
		});
	});

	it("takes the first value of a repeated parameter and rounds decimals", () => {
		expect(
			parseStickerRatingParams({
				voltage: ["231.26", "190"],
				amps: ["1.24"],
			}),
		).toEqual({ voltageV: 231.3, currentA: 1.2 });
	});

	it("drops each invalid field so it falls back to the next source", () => {
		expect(
			parseStickerRatingParams({
				voltage: "99",
				hz: "55",
				amps: "0",
				va: "5001",
				measured: "maybe",
				measuredAt: "2026-02-30",
			}),
		).toEqual({});
	});

	it("accepts the boolean spellings a person may type", () => {
		for (const value of ["1", "true", "yes", "on"]) {
			expect(parseStickerRatingParams({ measured: value })).toEqual({ measured: true });
		}
		for (const value of ["0", "false", "no", "off"]) {
			expect(parseStickerRatingParams({ measured: value })).toEqual({ measured: false });
		}
	});

	it("only accepts a real calendar date", () => {
		expect(isIsoDateString("2026-10-27")).toBe(true);
		expect(isIsoDateString("2024-02-29")).toBe(true);
		expect(isIsoDateString("2026-02-30")).toBe(false);
		expect(isIsoDateString("2026-13-01")).toBe(false);
		expect(isIsoDateString("27-10-2026")).toBe(false);
		expect(isIsoDateString(undefined)).toBe(false);
	});

	it("writes a round-trippable override and preserves other params", () => {
		const params = new URLSearchParams("id=dev-a1&id=dev-a2");

		applyStickerRatingParams(params, {
			voltageV: 230,
			frequencyHz: 50,
			currentA: 1.1,
			powerVA: 253,
			measured: true,
			measuredAt: "2026-10-27",
		});

		expect(params.getAll("id")).toEqual(["dev-a1", "dev-a2"]);
		expect(parseStickerRatingParams(Object.fromEntries(params))).toEqual({
			voltageV: 230,
			frequencyHz: 50,
			currentA: 1.1,
			powerVA: 253,
			measured: true,
			measuredAt: "2026-10-27",
		});

		applyStickerRatingParams(params, { ...LABEL_STICKER_RATING, measured: true });
		expect(params.get("measuredAt")).toBeNull();
	});

	it("clears every rating param but keeps the device ids", () => {
		const params = new URLSearchParams(
			"id=dev-a1&voltage=230&hz=50&amps=1.1&va=253&measured=1&measuredAt=2026-10-27",
		);

		clearStickerRatingParams(params);

		expect(params.toString()).toBe("id=dev-a1");
	});
});

describe("resolution order: URL → saved default → label", () => {
	it("uses the label when nothing is overridden", () => {
		const resolved = resolveStickerRating();
		expect(resolved).toEqual({
			...LABEL_STICKER_RATING,
			source: "estimated",
			enteredBy: null,
		});
	});

	it("uses the saved default when there is no URL override", () => {
		const resolved = resolveStickerRating({ saved: SAVED });
		expect(resolved).toEqual({
			...SAVED,
			source: "entered",
			enteredBy: "platform",
		});
	});

	it("lets the URL win over the saved default", () => {
		const resolved = resolveStickerRating({
			override: { voltageV: 240, measured: true, measuredAt: "2026-10-27" },
			saved: SAVED,
		});

		expect(resolved.voltageV).toBe(240);
		// Current still comes from the saved default.
		expect(resolved.currentA).toBe(1.1);
		// A changed voltage recomputes the VA instead of keeping 253.
		expect(resolved.powerVA).toBe(264);
		expect(resolved.source).toBe("measured");
		expect(resolved.enteredBy).toBeNull();
		expect(resolved.measuredAt).toBe("2026-10-27");
	});

	it("keeps an explicit VA from the URL", () => {
		const resolved = resolveStickerRating({
			override: { voltageV: 240, currentA: 1.1, powerVA: 400 },
		});
		expect(resolved.powerVA).toBe(400);
	});

	it("treats an entered but unmeasured rating as 'entered by actor'", () => {
		const resolved = resolveStickerRating({ override: { currentA: 1.3 } });
		expect(resolved.source).toBe("entered");
		expect(resolved.enteredBy).toBe("actor");
		expect(resolved.measured).toBe(false);
		expect(resolved.measuredAt).toBeNull();
	});

	it("drops the date when the rating is not measured", () => {
		const resolved = resolveStickerRating({
			saved: { ...SAVED, measured: true, measuredAt: "2026-10-01" },
			override: { measured: false },
		});
		expect(resolved.source).toBe("entered");
		expect(resolved.measuredAt).toBeNull();
	});

	it("supports a measured default with no date", () => {
		const resolved = resolveStickerRating({
			saved: { ...SAVED, measured: true, measuredAt: null },
		});
		expect(resolved.source).toBe("measured");
		expect(resolved.measuredAt).toBeNull();
	});
});

describe("stored value normalization", () => {
	it("accepts a stored rating and fills in a computed VA", () => {
		expect(
			normalizeStickerRating({
				voltageV: 230,
				frequencyHz: 50,
				currentA: 1.1,
				measured: true,
				measuredAt: "2026-10-27",
			}),
		).toEqual({
			voltageV: 230,
			frequencyHz: 50,
			currentA: 1.1,
			powerVA: 253,
			measured: true,
			measuredAt: "2026-10-27",
		});
	});

	it("rejects a missing, malformed or out-of-range value", () => {
		expect(normalizeStickerRating(null)).toBeNull();
		expect(normalizeStickerRating(20)).toBeNull();
		expect(normalizeStickerRating({})).toBeNull();
		expect(normalizeStickerRating({ ...SAVED, voltageV: 99 })).toBeNull();
		expect(normalizeStickerRating({ ...SAVED, frequencyHz: 55 })).toBeNull();
		expect(normalizeStickerRating({ ...SAVED, currentA: 21 })).toBeNull();
		expect(normalizeStickerRating({ ...SAVED, powerVA: 5001 })).toBeNull();
	});

	it("ignores a date on an unmeasured rating and a bad date", () => {
		expect(normalizeStickerRating({ ...SAVED, measuredAt: "2026-10-27" })?.measuredAt).toBeNull();
		expect(
			normalizeStickerRating({ ...SAVED, measured: true, measuredAt: "not-a-date" })?.measuredAt,
		).toBeNull();
	});
});
