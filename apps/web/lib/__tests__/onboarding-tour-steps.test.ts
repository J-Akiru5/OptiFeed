import { ONBOARDING_TOUR_STEPS } from "@/components/onboarding-tour-steps";
import { describe, expect, it } from "vitest";

describe("onboarding tour step order", () => {
	it("opens with a centred welcome step", () => {
		expect(ONBOARDING_TOUR_STEPS[0]?.selector).toBeNull();
		expect(ONBOARDING_TOUR_STEPS[0]?.title).toBe("Welcome to PakaonAI");
	});

	it("walks the dashboard top to bottom: header, bento tiles, sidebar", () => {
		expect(ONBOARDING_TOUR_STEPS.map((step) => step.selector)).toEqual([
			null,
			"[data-onboard='feed-now']",
			"[data-onboard='next-feeding']",
			"[data-onboard='fcr']",
			"[data-onboard='settings']",
		]);
	});

	it("keeps the five tutorial steps", () => {
		expect(ONBOARDING_TOUR_STEPS).toHaveLength(5);
	});
});
