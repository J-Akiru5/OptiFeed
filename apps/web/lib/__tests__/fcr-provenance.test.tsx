import { FcrProvenanceNote, fcrProvenanceText } from "@/components/growth/fcr-provenance";
import {
	assessStoredFcrReport,
	resolveFcrDisplay,
	storedFcrContradictsTotals,
	verifiedFcrValue,
} from "@/lib/analytics/fcr";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTranslator } from "./helpers/messages";

/**
 * Issue #875: a stored FcrReport row is only "verified" when the logs in its
 * own period could reproduce it. These cases use the measured demo-tenant
 * shapes: a claimed 1.3 whose own totals imply 0.22, and a claimed 1.8 over a
 * period with no feed logs at all.
 */

const covered = { feedEvents: 4, biomassSamples: 6 };

describe("storedFcrContradictsTotals", () => {
	it("accepts a row whose own feed and gain produce its ratio", () => {
		// 105.975 kg feed / 70.65 kg gain = 1.5 exactly.
		expect(
			storedFcrContradictsTotals({
				totalFeedKg: 105.975,
				biomassGainKg: 70.65,
				fcrValue: 1.5,
			}),
		).toBe(false);
	});

	it("flags the demo-tenant claim of 1.3 against 33.9 kg feed and 153.8 kg gain", () => {
		// The row implies 0.22, not 1.30.
		expect(
			storedFcrContradictsTotals({
				totalFeedKg: 33.9,
				biomassGainKg: 153.8,
				fcrValue: 1.3,
			}),
		).toBe(true);
	});

	it("flags a claimed ratio when the stored gain is zero", () => {
		expect(
			storedFcrContradictsTotals({
				totalFeedKg: 0,
				biomassGainKg: 0,
				fcrValue: 1.8,
			}),
		).toBe(true);
	});

	it("treats a missing or negative total as a contradiction", () => {
		expect(
			storedFcrContradictsTotals({
				totalFeedKg: Number.NaN,
				biomassGainKg: 50,
				fcrValue: 1.5,
			}),
		).toBe(true);
		expect(
			storedFcrContradictsTotals({
				totalFeedKg: -1,
				biomassGainKg: 50,
				fcrValue: 1.5,
			}),
		).toBe(true);
	});

	it("absorbs normal 2-decimal rounding without hiding a real disagreement", () => {
		// 100 / 70 = 1.42857..., stored as 1.43.
		expect(
			storedFcrContradictsTotals({
				totalFeedKg: 100,
				biomassGainKg: 70,
				fcrValue: 1.43,
			}),
		).toBe(false);
		// 0.05 off is a real disagreement.
		expect(
			storedFcrContradictsTotals({
				totalFeedKg: 100,
				biomassGainKg: 70,
				fcrValue: 1.48,
			}),
		).toBe(true);
	});
});

describe("assessStoredFcrReport", () => {
	it("labels a fully covered row that contradicts its own totals", () => {
		const assessment = assessStoredFcrReport(
			{ totalFeedKg: 33.9, biomassGainKg: 153.8, fcrValue: 1.3 },
			covered,
		);

		expect(assessment.verified).toBe(false);
		expect(assessment.contradictsTotals).toBe(true);
		expect(assessment.reasons).toEqual(["stored-contradicts-totals"]);
	});

	it("labels a zero-coverage period as neither feed nor biomass evidence", () => {
		const assessment = assessStoredFcrReport(
			{ totalFeedKg: 0, biomassGainKg: 500, fcrValue: 1.8 },
			{ feedEvents: 0, biomassSamples: 0 },
		);

		expect(assessment.verified).toBe(false);
		expect(assessment.reasons).toEqual([
			"no-feed-logs",
			"no-biomass-samples",
			"stored-contradicts-totals",
		]);
	});

	it("needs two samples, not one, to reproduce a gain", () => {
		const assessment = assessStoredFcrReport(
			{ totalFeedKg: 100, biomassGainKg: 50, fcrValue: 2 },
			{ feedEvents: 3, biomassSamples: 1 },
		);

		expect(assessment.verified).toBe(false);
		expect(assessment.reasons).toEqual(["no-biomass-samples"]);
	});

	it("verifies only a covered row whose arithmetic holds", () => {
		const assessment = assessStoredFcrReport(
			{ totalFeedKg: 105.975, biomassGainKg: 70.65, fcrValue: 1.5 },
			covered,
		);

		expect(assessment.verified).toBe(true);
		expect(assessment.reasons).toEqual([]);
		expect(assessment.contradictsTotals).toBe(false);
	});
});

describe("resolveFcrDisplay", () => {
	const stored = [
		assessStoredFcrReport(
			{ totalFeedKg: 0, biomassGainKg: 500, fcrValue: 1.8 },
			{ feedEvents: 0, biomassSamples: 0 },
		),
	];

	it("lets the computed value win even when a stored row exists", () => {
		const display = resolveFcrDisplay(1.42, stored);

		expect(display).toMatchObject({
			value: 1.42,
			source: "computed",
			unverifiedReasons: [],
		});
		expect(display?.storedReport).toBeNull();
	});

	it("returns the stored value with its reasons when computation is impossible", () => {
		const display = resolveFcrDisplay(null, stored);

		expect(display?.source).toBe("stored");
		expect(display?.value).toBe(1.8);
		expect(display?.unverifiedReasons).toEqual([
			"no-feed-logs",
			"no-biomass-samples",
			"stored-contradicts-totals",
		]);
	});

	it("does not turn a zero or missing computed value into a display value", () => {
		expect(resolveFcrDisplay(0, [])).toBeNull();
		expect(resolveFcrDisplay(Number.NaN, [])).toBeNull();
		expect(resolveFcrDisplay(null, [])).toBeNull();
	});
});

describe("verifiedFcrValue", () => {
	it("accepts the computed value and a reproduced stored value", () => {
		expect(verifiedFcrValue(resolveFcrDisplay(1.42, []))).toBe(1.42);

		const verifiedStored = resolveFcrDisplay(null, [
			assessStoredFcrReport({ totalFeedKg: 100, biomassGainKg: 50, fcrValue: 2 }, covered),
		]);
		expect(verifiedFcrValue(verifiedStored)).toBe(2);
	});

	it("refuses an unverified stored value instead of returning a number", () => {
		const unverified = resolveFcrDisplay(null, [
			assessStoredFcrReport({ totalFeedKg: 33.9, biomassGainKg: 153.8, fcrValue: 1.3 }, covered),
		]);

		expect(verifiedFcrValue(unverified)).toBeNull();
	});
});

describe("FCR provenance label", () => {
	it("maps every reason to a visible, translated sentence in each locale", () => {
		for (const locale of ["en", "tl", "hil"] as const) {
			const t = createTranslator("dashboard.fcrProvenance", locale);
			const text = fcrProvenanceText(
				{
					source: "stored",
					unverifiedReasons: ["no-feed-logs", "stored-contradicts-totals"],
				},
				t,
			);

			expect(text).not.toBeNull();
			expect(text?.tone).toBe("danger");
			expect(text?.messages).toEqual([
				t("reasons.no-feed-logs"),
				t("reasons.stored-contradicts-totals"),
			]);
			expect(text?.messages.join(" ")).not.toMatch(/dashboard\.fcrProvenance/);
			if (!text) throw new Error(`no provenance label for ${locale}`);

			const html = renderToStaticMarkup(<FcrProvenanceNote text={text} />);
			expect(html).toContain('role="note"');
			expect(html).toContain(t("badge"));
			expect(html).toContain(t("reasons.no-feed-logs"));
			expect(html).toContain(t("reasons.stored-contradicts-totals"));
		}
	});

	it("uses the verified sentence when a stored row is reproduced by its logs", () => {
		const t = createTranslator("dashboard.fcrProvenance");
		const text = fcrProvenanceText({ source: "stored", unverifiedReasons: [] }, t);

		expect(text?.tone).toBe("warning");
		expect(text?.messages).toEqual([t("verified")]);
	});

	it("renders nothing for a computed value", () => {
		expect(
			fcrProvenanceText({ source: "computed", unverifiedReasons: [] }, (key) => key),
		).toBeNull();
		expect(fcrProvenanceText(null, (key) => key)).toBeNull();
	});
});
