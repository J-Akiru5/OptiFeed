import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * #828: a new cycle starts from the pond override, then the farm default, then
 * the documented constant. The form labels which layer supplied each value,
 * and switching pond applies the new pond's defaults only while the operator
 * has not typed an agronomic value (#825's rule).
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
	};
});

vi.mock("@/i18n/routing", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/actions/crop-cycle", () => ({
	createCropCycle: vi.fn(async () => ({ success: true, cycleId: "cycle-new" })),
	updateCropCycle: vi.fn(),
}));

import { CycleForm } from "@/components/harvest/cycle-form";
import { addDays, todayDateOnly } from "@/lib/crop-cycle/dates";
import type { PondOption } from "@/lib/crop-cycle/types";
import { SYSTEM_GROWTH_DEFAULTS, resolveGrowthDefaults } from "@/lib/growth/defaults";

const farm = {
	growOutDays: 120,
	targetHarvestWeightG: 300,
	expectedSurvivalPct: 90,
	stockingAvgWeightG: 8,
	densityAdvisoryPerM2: 25,
};

const pond: PondOption = {
	id: "pond-a",
	name: "Pond A",
	isFallow: false,
	population: 1000,
	areaM2: 100,
	averageDepthM: 1.5,
	savedTargetWeightG: null,
	growthDefaults: resolveGrowthDefaults(farm, null),
};

const pondB: PondOption = {
	...pond,
	id: "pond-b",
	name: "Pond B",
	population: 4000,
	growthDefaults: resolveGrowthDefaults(null, {
		growOutDays: 200,
		targetHarvestWeightG: 400,
		expectedSurvivalPct: 95,
		stockingAvgWeightG: 12,
		densityAdvisoryPerM2: 30,
	}),
};

function renderForm(ponds: PondOption[] = [pond]) {
	return render(
		<CycleForm open onClose={vi.fn()} onSaved={vi.fn()} ponds={ponds} initialPondId="pond-a" />,
	);
}

describe("CycleForm growth defaults (#828)", () => {
	it("starts a new cycle from the farm defaults and names the layer", () => {
		renderForm();

		expect(screen.getByLabelText("Grow-out days")).toHaveValue(120);
		expect(screen.getByLabelText("Target weight (g)")).toHaveValue(300);
		expect(screen.getByLabelText("Expected survival (%)")).toHaveValue(90);
		expect(screen.getByLabelText("Stocking weight (g)")).toHaveValue(8);
		expect(screen.getByLabelText("Target harvest date")).toHaveValue(addDays(todayDateOnly(), 120));

		// The grow-out and target fields come from the farm; nothing is a
		// pond override yet, and no accidental "system default" is claimed.
		expect(screen.queryByText("Pond override")).not.toBeInTheDocument();
		expect(screen.getAllByText("Farm default").length).toBeGreaterThanOrEqual(3);
	});

	it("uses the documented constants when the payload has no defaults", () => {
		renderForm([{ ...pond, growthDefaults: undefined }]);

		expect(screen.getByLabelText("Grow-out days")).toHaveValue(SYSTEM_GROWTH_DEFAULTS.growOutDays);
		expect(screen.getByLabelText("Target weight (g)")).toHaveValue(
			SYSTEM_GROWTH_DEFAULTS.targetHarvestWeightG,
		);
		expect(screen.getByLabelText("Expected survival (%)")).toHaveValue(
			SYSTEM_GROWTH_DEFAULTS.expectedSurvivalPct,
		);
		expect(screen.getByLabelText("Stocking weight (g)")).toHaveValue(null);
	});

	it("applies another pond's defaults when the operator switches pond", () => {
		renderForm([pond, pondB]);

		fireEvent.change(screen.getByLabelText("Pond"), { target: { value: "pond-b" } });

		expect(screen.getByLabelText("Stocking count")).toHaveValue(4000);
		expect(screen.getByLabelText("Grow-out days")).toHaveValue(200);
		expect(screen.getByLabelText("Target weight (g)")).toHaveValue(400);
		expect(screen.getByLabelText("Expected survival (%)")).toHaveValue(95);
		expect(screen.getByLabelText("Stocking weight (g)")).toHaveValue(12);
		expect(screen.getByLabelText("Target harvest date")).toHaveValue(addDays(todayDateOnly(), 200));
		expect(screen.getAllByText("Pond override").length).toBeGreaterThanOrEqual(3);
	});

	it("keeps typed values when the operator switches pond", () => {
		renderForm([pond, pondB]);

		fireEvent.change(screen.getByLabelText("Target weight (g)"), { target: { value: "320" } });
		fireEvent.change(screen.getByLabelText("Pond"), { target: { value: "pond-b" } });

		expect(screen.getByLabelText("Target weight (g)")).toHaveValue(320);
		expect(screen.getByLabelText("Grow-out days")).toHaveValue(120);
	});
});
