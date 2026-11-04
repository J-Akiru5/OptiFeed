import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #826 part 1 (owner decisions 3 and 4):
 *
 * - the harvest date is the operator's anchor; moving the stocking date
 *   re-derives the grow-out period instead of shifting the harvest date;
 * - an emptied grow-out field snaps to the date pair (or the documented 135
 *   days), never to `NaN` or an invalid date;
 * - an out-of-range date pair never renders a negative or >365 period and
 *   never saves;
 * - a saved `null` target weight or survival renders empty and stays null.
 *
 * #825 behaviour (a usable typed period still moves the harvest date) is
 * covered by `cycle-form-live-refresh.test.tsx`, which must keep passing.
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
	createCropCycle: vi.fn(),
	updateCropCycle: vi.fn(),
}));

import { CycleForm } from "@/components/harvest/cycle-form";
import { createCropCycle, updateCropCycle } from "@/lib/actions/crop-cycle";
import { addDays, todayDateOnly } from "@/lib/crop-cycle/dates";
import type { CropCycleDto, PondOption } from "@/lib/crop-cycle/types";

const create = vi.mocked(createCropCycle);
const update = vi.mocked(updateCropCycle);

const pond: PondOption = {
	id: "pond-a",
	name: "Pond A",
	isFallow: false,
	population: 1000,
	areaM2: 100,
	averageDepthM: 1.5,
	savedTargetWeightG: null,
};

/** 2026-09-01 → 2026-12-30 is 120 days, matching `growOutDays`. */
const cycle: CropCycleDto = {
	id: "cycle-1",
	pondId: "pond-a",
	label: "Cycle A",
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

const DATE_RANGE_ERROR = "Choose a harvest date between 30 and 365 days after stocking.";

function renderForm(overrides: Partial<CropCycleDto> | null = {}) {
	const onClose = vi.fn();
	const onSaved = vi.fn();
	render(
		<CycleForm
			open
			onClose={onClose}
			onSaved={onSaved}
			ponds={[{ ...pond }]}
			initialPondId="pond-a"
			cycle={overrides === null ? null : { ...cycle, ...overrides }}
		/>,
	);
	return { onClose, onSaved };
}

function save() {
	fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
}

beforeEach(() => {
	create.mockReset();
	create.mockResolvedValue({ success: true, cycleId: "cycle-new" });
	update.mockReset();
	update.mockResolvedValue({ success: true, cycleId: "cycle-1" });
});

describe("CycleForm date cascade (#826)", () => {
	it("keeps the harvest date and re-derives grow-out days when the stocking date moves", async () => {
		renderForm();

		fireEvent.change(screen.getByLabelText("Stocking date"), {
			target: { value: "2026-09-11" },
		});

		expect(screen.getByLabelText("Target harvest date")).toHaveValue("2026-12-30");
		expect(screen.getByLabelText("Grow-out days")).toHaveValue(110);

		save();

		await waitFor(() => {
			expect(update).toHaveBeenCalledWith(
				"cycle-1",
				expect.objectContaining({
					stockingDate: "2026-09-11",
					targetHarvestDate: "2026-12-30",
					growOutDays: 110,
				}),
			);
		});
	});

	it("keeps every unrelated field when the stocking date moves", () => {
		renderForm();

		fireEvent.change(screen.getByLabelText("Cycle label"), {
			target: { value: "Cycle 2026-11" },
		});
		fireEvent.change(screen.getByLabelText("Notes"), {
			target: { value: "Hatchery batch 4" },
		});
		fireEvent.change(screen.getByLabelText("Stocking count"), {
			target: { value: "1500" },
		});
		fireEvent.change(screen.getByLabelText("Stocking weight (g)"), {
			target: { value: "12.5" },
		});
		fireEvent.change(screen.getByLabelText("Target weight (g)"), {
			target: { value: "300" },
		});
		fireEvent.change(screen.getByLabelText("Expected survival (%)"), {
			target: { value: "90" },
		});

		fireEvent.change(screen.getByLabelText("Stocking date"), {
			target: { value: "2026-09-11" },
		});

		expect(screen.getByLabelText("Cycle label")).toHaveValue("Cycle 2026-11");
		expect(screen.getByLabelText("Notes")).toHaveValue("Hatchery batch 4");
		expect(screen.getByLabelText("Stocking count")).toHaveValue(1500);
		expect(screen.getByLabelText("Stocking weight (g)")).toHaveValue(12.5);
		expect(screen.getByLabelText("Target weight (g)")).toHaveValue(300);
		expect(screen.getByLabelText("Expected survival (%)")).toHaveValue(90);
	});

	it("re-derives grow-out days from a new harvest date", () => {
		renderForm();

		fireEvent.change(screen.getByLabelText("Target harvest date"), {
			target: { value: "2026-11-30" },
		});

		expect(screen.getByLabelText("Grow-out days")).toHaveValue(90);
	});

	it("never shows a negative or >365 period, and blocks the save", () => {
		renderForm();

		fireEvent.change(screen.getByLabelText("Target harvest date"), {
			target: { value: "2026-09-05" },
		});
		expect(screen.getByLabelText("Grow-out days")).toHaveValue(120);
		expect(screen.getByText(DATE_RANGE_ERROR)).toBeInTheDocument();

		save();
		expect(update).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText("Target harvest date"), {
			target: { value: "2027-10-01" },
		});
		expect(screen.getByLabelText("Grow-out days")).toHaveValue(120);
		expect(screen.getAllByText(DATE_RANGE_ERROR).length).toBeGreaterThan(0);

		save();
		expect(update).not.toHaveBeenCalled();
	});

	it("snaps an emptied field back to the date pair on blur", () => {
		renderForm();

		const growOut = screen.getByLabelText("Grow-out days");
		fireEvent.change(growOut, { target: { value: "" } });
		expect(growOut).toHaveValue(null);
		expect(screen.getByLabelText("Target harvest date")).toHaveValue("2026-12-30");

		fireEvent.blur(growOut);

		expect(screen.getByLabelText("Grow-out days")).toHaveValue(120);
		expect(screen.getByLabelText("Target harvest date")).toHaveValue("2026-12-30");
	});

	it("snaps an emptied field back to the date pair on save", async () => {
		renderForm();

		fireEvent.change(screen.getByLabelText("Grow-out days"), { target: { value: "" } });
		save();

		await waitFor(() => {
			expect(update).toHaveBeenCalledWith(
				"cycle-1",
				expect.objectContaining({ growOutDays: 120, targetHarvestDate: "2026-12-30" }),
			);
		});
	});

	it("ignores an out-of-range typed period and leaves the harvest date alone", () => {
		renderForm();

		const growOut = screen.getByLabelText("Grow-out days");

		fireEvent.change(growOut, { target: { value: "20" } });
		expect(screen.getByLabelText("Target harvest date")).toHaveValue("2026-12-30");
		fireEvent.blur(growOut);
		expect(screen.getByLabelText("Grow-out days")).toHaveValue(120);

		fireEvent.change(screen.getByLabelText("Grow-out days"), { target: { value: "400" } });
		expect(screen.getByLabelText("Target harvest date")).toHaveValue("2026-12-30");
		fireEvent.blur(screen.getByLabelText("Grow-out days"));
		expect(screen.getByLabelText("Grow-out days")).toHaveValue(120);
	});

	it("saves the period the field displays, not a rejected entry", async () => {
		renderForm();

		// No blur: clicking Save is what commits the field, and the payload must
		// match the period the field then shows.
		fireEvent.change(screen.getByLabelText("Grow-out days"), { target: { value: "20" } });
		save();

		await waitFor(() => {
			expect(update).toHaveBeenCalledWith(
				"cycle-1",
				expect.objectContaining({ growOutDays: 120, targetHarvestDate: "2026-12-30" }),
			);
		});
		expect(screen.getByLabelText("Grow-out days")).toHaveValue(120);
	});

	it("falls back to the documented 135 days when no date pair is usable", () => {
		renderForm();

		fireEvent.change(screen.getByLabelText("Stocking date"), { target: { value: "" } });
		fireEvent.change(screen.getByLabelText("Grow-out days"), { target: { value: "" } });

		expect(screen.getByText(DATE_RANGE_ERROR)).toBeInTheDocument();

		fireEvent.blur(screen.getByLabelText("Grow-out days"));

		expect(screen.getByLabelText("Grow-out days")).toHaveValue(135);
		expect(screen.getByText(DATE_RANGE_ERROR)).toBeInTheDocument();
	});

	it("re-derives the period after clearing and re-entering the stocking date", () => {
		renderForm();

		fireEvent.change(screen.getByLabelText("Stocking date"), { target: { value: "" } });
		expect(screen.getByText(DATE_RANGE_ERROR)).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("Stocking date"), {
			target: { value: "2026-09-21" },
		});

		expect(screen.getByLabelText("Grow-out days")).toHaveValue(100);
		expect(screen.getByLabelText("Target harvest date")).toHaveValue("2026-12-30");
	});
});

describe("CycleForm null handling (#826)", () => {
	it("renders a saved null target weight and survival as empty", () => {
		renderForm({ targetHarvestWeightG: null, expectedSurvivalPct: null });

		expect(screen.getByLabelText("Target weight (g)")).toHaveValue(null);
		expect(screen.getByLabelText("Expected survival (%)")).toHaveValue(null);
	});

	it("saves null rather than resurrecting 250 / 85", async () => {
		renderForm({ targetHarvestWeightG: null, expectedSurvivalPct: null });

		save();

		await waitFor(() => {
			expect(update).toHaveBeenCalledWith(
				"cycle-1",
				expect.objectContaining({
					targetHarvestWeightG: null,
					expectedSurvivalPct: null,
				}),
			);
		});
	});

	it("still starts a new cycle from the documented defaults", () => {
		renderForm(null);

		expect(screen.getByLabelText("Target weight (g)")).toHaveValue(250);
		expect(screen.getByLabelText("Expected survival (%)")).toHaveValue(85);
		expect(screen.getByLabelText("Grow-out days")).toHaveValue(135);
		expect(screen.getByLabelText("Target harvest date")).toHaveValue(addDays(todayDateOnly(), 135));
	});
});
