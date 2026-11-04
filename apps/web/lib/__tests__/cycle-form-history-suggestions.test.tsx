import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * #828 acceptance: a completed cycle is shown as a suggestion with evidence
 * and is applied only on an explicit press. The field must still hold the
 * farm/default value before that press, and an ignored suggestion must not
 * change anything.
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
import type { CropCycleDto, PondOption } from "@/lib/crop-cycle/types";
import { resolveGrowthDefaults } from "@/lib/growth/defaults";
import type { GrowthHistorySuggestion } from "@/lib/growth/history";

const suggestions: GrowthHistorySuggestion[] = [
	{
		field: "expectedSurvivalPct",
		value: 82,
		sampleSize: 3,
		min: 82,
		max: 90,
		sourceCycleId: "cycle-1",
		sourceLabel: "Cycle 2026-09",
		sourcePondName: "Pond A",
		sourceHarvestDate: "2027-01-05",
	},
	{
		field: "targetHarvestWeightG",
		value: 256.1,
		sampleSize: 3,
		min: 250,
		max: 256.1,
		sourceCycleId: "cycle-1",
		sourceLabel: "Cycle 2026-09",
		sourcePondName: "Pond A",
		sourceHarvestDate: "2027-01-05",
	},
	{
		field: "growOutDays",
		value: 126,
		sampleSize: 3,
		min: 126,
		max: 131,
		sourceCycleId: "cycle-1",
		sourceLabel: "Cycle 2026-09",
		sourcePondName: "Pond A",
		sourceHarvestDate: "2027-01-05",
	},
];

const pond: PondOption = {
	id: "pond-a",
	name: "Pond A",
	isFallow: false,
	population: 1000,
	areaM2: 100,
	averageDepthM: 1.5,
	savedTargetWeightG: null,
	growthDefaults: resolveGrowthDefaults(
		{
			growOutDays: 120,
			targetHarvestWeightG: 300,
			expectedSurvivalPct: 90,
			stockingAvgWeightG: null,
			densityAdvisoryPerM2: null,
		},
		null,
	),
	growthSuggestions: suggestions,
};

const cycle: CropCycleDto = {
	id: "cycle-1",
	pondId: "pond-a",
	label: "Cycle 2026-09",
	status: "ACTIVE",
	stockingDate: "2026-09-01",
	stockingCount: 1000,
	stockingAvgWeightG: 10,
	growOutDays: 120,
	targetHarvestDate: "2026-12-30",
	targetHarvestWeightG: 250,
	expectedSurvivalPct: 85,
	actualHarvestDate: null,
	actualHarvestWeightKg: null,
	actualHarvestCount: null,
	actualFcr: null,
	notes: null,
};

function renderForm(withSuggestions: GrowthHistorySuggestion[] = suggestions) {
	return render(
		<CycleForm
			open
			onClose={vi.fn()}
			onSaved={vi.fn()}
			ponds={[{ ...pond, growthSuggestions: withSuggestions }]}
			initialPondId="pond-a"
		/>,
	);
}

describe("CycleForm history suggestions (#828)", () => {
	it("shows the suggestion and its evidence without prefilling it", () => {
		renderForm();

		expect(screen.getByText("Suggested from your completed cycles")).toBeInTheDocument();
		expect(screen.getAllByText(/Last: Cycle 2026-09 · Pond A · 2027-01-05/).length).toBeGreaterThan(
			0,
		);
		expect(screen.getAllByText(/3 completed cycles · range 82 %–90 %/).length).toBeGreaterThan(0);

		// The field still holds the farm default until the operator accepts.
		expect(screen.getByLabelText("Expected survival (%)")).toHaveValue(90);
		expect(screen.getByLabelText("Target weight (g)")).toHaveValue(300);
		expect(screen.getByLabelText("Grow-out days")).toHaveValue(120);
	});

	it("applies a suggestion only after the Use button is pressed", () => {
		renderForm();

		fireEvent.click(screen.getByRole("button", { name: "Expected survival (%): Use" }));

		expect(screen.getByLabelText("Expected survival (%)")).toHaveValue(82);
		expect(screen.getByRole("button", { name: "Expected survival (%): Applied" })).toBeDisabled();
		// The other fields were not touched.
		expect(screen.getByLabelText("Target weight (g)")).toHaveValue(300);
	});

	it("moves the harvest date when the grow-out suggestion is accepted", () => {
		renderForm();

		fireEvent.click(screen.getByRole("button", { name: "Grow-out days: Use" }));

		expect(screen.getByLabelText("Grow-out days")).toHaveValue(126);
		expect(screen.getByLabelText("Target harvest date")).toHaveValue(addDays(todayDateOnly(), 126));
	});

	it("ignores a suggestion the operator does not press", () => {
		renderForm();

		expect(screen.getByLabelText("Target weight (g)")).toHaveValue(300);
		expect(screen.getByLabelText("Expected survival (%)")).toHaveValue(90);
	});

	it("shows no suggestion panel when the farm has no history", () => {
		renderForm([]);

		expect(screen.queryByText("Suggested from your completed cycles")).not.toBeInTheDocument();
	});

	it("shows no suggestion panel while editing an existing cycle", () => {
		render(
			<CycleForm
				open
				onClose={vi.fn()}
				onSaved={vi.fn()}
				ponds={[pond]}
				initialPondId="pond-a"
				cycle={cycle}
			/>,
		);

		expect(screen.queryByText("Suggested from your completed cycles")).not.toBeInTheDocument();
	});
});
