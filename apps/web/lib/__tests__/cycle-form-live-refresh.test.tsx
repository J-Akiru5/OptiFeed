import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #825: `DashboardLiveRefresh` calls `router.refresh()` every 30 s while the
 * tab is visible and again on `visibilitychange`. The RSC payload is
 * re-deserialised, so `ponds` reaches the dialog as a new (deep-equal) array
 * while it stays open. The form must keep what the farmer typed and only
 * re-initialise on its own identity: cycle id + initial pond, or a reopen.
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

const pondB: PondOption = { ...pond, id: "pond-b", name: "Pond B", population: 4000 };

const cycle: CropCycleDto = {
	id: "cycle-1",
	pondId: "pond-a",
	label: "Cycle A",
	status: "ACTIVE",
	stockingDate: "2026-09-01",
	stockingCount: 4321,
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

interface FormProps {
	open: boolean;
	ponds: PondOption[];
	initialPondId: string;
	cycle: CropCycleDto | null;
}

function formProps(overrides: Partial<FormProps> = {}): FormProps {
	return {
		open: true,
		ponds: [{ ...pond }],
		initialPondId: "pond-a",
		cycle: null,
		...overrides,
	};
}

function renderForm(overrides: Partial<FormProps> = {}) {
	const onClose = vi.fn();
	const onSaved = vi.fn();
	let props = formProps(overrides);
	const element = () => <CycleForm onClose={onClose} onSaved={onSaved} {...props} />;
	const view = render(element());
	const rerenderForm = (next: Partial<FormProps> = {}) => {
		props = { ...props, ...next };
		view.rerender(element());
	};
	return { ...view, rerenderForm, onClose, onSaved };
}

beforeEach(() => {
	create.mockReset();
	create.mockResolvedValue({ success: true, cycleId: "cycle-new" });
	update.mockReset();
	update.mockResolvedValue({ success: true, cycleId: "cycle-1" });
});

describe("CycleForm under live refresh (#825)", () => {
	it("keeps typed values when ponds arrives as a new deep-equal array", () => {
		const { rerenderForm } = renderForm();

		fireEvent.change(screen.getByLabelText("Cycle label"), {
			target: { value: "Cycle 2026-11" },
		});
		fireEvent.change(screen.getByLabelText("Notes"), {
			target: { value: "Hatchery batch 4" },
		});

		// Exactly what the RSC payload produces: a fresh array of fresh objects.
		rerenderForm({ ponds: [{ ...pond }] });

		expect(screen.getByLabelText("Cycle label")).toHaveValue("Cycle 2026-11");
		expect(screen.getByLabelText("Notes")).toHaveValue("Hatchery batch 4");
	});

	it("does not re-derive the stocking count from a refreshed population", () => {
		const { rerenderForm } = renderForm();

		expect(screen.getByLabelText("Stocking count")).toHaveValue(1000);
		fireEvent.change(screen.getByLabelText("Stocking count"), { target: { value: "1500" } });

		rerenderForm({ ponds: [{ ...pond, population: 2000 }] });

		expect(screen.getByLabelText("Stocking count")).toHaveValue(1500);
	});

	it("re-initialises after the dialog is closed and reopened", () => {
		const { rerenderForm } = renderForm();

		fireEvent.change(screen.getByLabelText("Cycle label"), {
			target: { value: "Draft" },
		});
		fireEvent.change(screen.getByLabelText("Notes"), {
			target: { value: "Draft notes" },
		});

		rerenderForm({ open: false });
		rerenderForm({ open: true });

		expect(screen.getByLabelText("Cycle label")).toHaveValue("");
		expect(screen.getByLabelText("Notes")).toHaveValue("");
	});

	it("re-initialises when the initial pond changes", () => {
		const { rerenderForm } = renderForm({ ponds: [{ ...pond }, pondB] });

		expect(screen.getByLabelText("Stocking count")).toHaveValue(1000);

		rerenderForm({ initialPondId: "pond-b" });

		expect(screen.getByLabelText("Pond")).toHaveValue("pond-b");
		expect(screen.getByLabelText("Stocking count")).toHaveValue(4000);
	});

	it("re-initialises when the form changes from a new cycle to an edit", () => {
		const { rerenderForm } = renderForm();

		fireEvent.change(screen.getByLabelText("Cycle label"), {
			target: { value: "Draft" },
		});

		rerenderForm({ cycle });

		expect(screen.getByLabelText("Cycle label")).toHaveValue("Cycle A");
		expect(screen.getByLabelText("Stocking count")).toHaveValue(4321);
	});

	it("keeps an empty grow-out field empty and still saves the date span", async () => {
		renderForm({ cycle });

		const growOut = screen.getByLabelText("Grow-out days");
		expect(growOut).toHaveValue(120);

		fireEvent.change(growOut, { target: { value: "" } });

		expect(screen.getByLabelText("Grow-out days")).toHaveValue(null);
		expect(screen.getByLabelText("Target harvest date")).toHaveValue("2026-12-30");

		fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

		// The committed span still comes from the date pair (crop-cycle.ts),
		// not from the raw input, so the payload is unchanged.
		await waitFor(() => {
			expect(update).toHaveBeenCalledWith("cycle-1", expect.objectContaining({ growOutDays: 120 }));
		});
	});

	it("still moves the target harvest date when grow-out days are typed", () => {
		renderForm({ cycle });

		fireEvent.change(screen.getByLabelText("Grow-out days"), { target: { value: "90" } });

		expect(screen.getByLabelText("Target harvest date")).toHaveValue("2026-11-30");
	});
});
