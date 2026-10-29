import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
	};
});

vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children }: { href: string; children?: ReactNode }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/actions/growth-plan", () => ({ applyGrowthPlan: vi.fn() }));
vi.mock("@/lib/actions/growth-target", () => ({ clearGrowthTarget: vi.fn() }));

import { GrowthPlanCard } from "@/components/growth/GrowthPlanCard";
import { buildGrowthPlan } from "@/lib/growth-plan";

const cycle = {
	id: "cycle-1",
	label: "Batch 2026-A",
	stockingDate: "2026-01-01",
	stockingCount: 1000,
	stockingAvgWeightG: 10,
	growOutDays: 120,
	targetHarvestDate: "2026-05-01",
	targetHarvestWeightG: 330,
	expectedSurvivalPct: 90,
};

function planFor(savedTargetWeightG: number | null) {
	return buildGrowthPlan({
		cycle,
		latestSample: { id: "sample-2", date: "2026-03-02", avgWeightG: 120, sampleCount: 30 },
		previousSample: { id: "sample-1", date: "2026-02-01", avgWeightG: 100, sampleCount: 30 },
		population: 1000,
		feedingRatePct: 3,
		feedsPerDay: 3,
		currentGramsPerFeeding: 1000,
		deviceMaxGramsPerFeeding: 1000,
		latestFcr: 1.5,
		lastAdjustmentAt: null,
		today: "2026-03-02",
		pond: { areaM2: 100, averageDepthM: 1.5, feedPricePerKg: 30 },
		savedTarget:
			savedTargetWeightG === null
				? null
				: { targetWeightG: savedTargetWeightG, cycleId: "cycle-1", population: 1000 },
	});
}

describe("GrowthPlanCard", () => {
	it("shows the saved target, the biomass figures and the gap", () => {
		const html = renderToStaticMarkup(
			<GrowthPlanCard plan={planFor(400)} pondId="pond-a" canWrite />,
		);

		expect(html).toContain("Calculator target");
		expect(html).toContain("Harvest biomass");
		expect(html).toContain("Target at harvest");
		expect(html).toContain("360.0 kg");
		expect(html).toContain("108.0 kg");
		expect(html).toContain("184.5 kg");
		expect(html).toContain("+252.0 kg");
		expect(html).toContain("Remove target");
	});

	it("does not offer to remove the target when the cycle target is in use", () => {
		const html = renderToStaticMarkup(
			<GrowthPlanCard plan={planFor(null)} pondId="pond-a" canWrite />,
		);

		expect(html).toContain("297.0 kg");
		expect(html).not.toContain("Calculator target");
		expect(html).not.toContain("Remove target");
	});
});
