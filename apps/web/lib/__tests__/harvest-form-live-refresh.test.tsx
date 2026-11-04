import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * #825: `harvest-calendar.tsx` rebuilds `cycle` through `cycleForPond` on every
 * render, and `DashboardLiveRefresh` re-renders the page with a fresh RSC
 * payload every 30 s. Without an identity guard the harvest dialog resets the
 * weight, count and notes the farmer is typing.
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

vi.mock("@/lib/actions/crop-cycle", () => ({ markCycleHarvested: vi.fn() }));

import { HarvestForm } from "@/components/harvest/harvest-form";
import type { CropCycleDto } from "@/lib/crop-cycle/types";

const cycle: CropCycleDto = {
	id: "cycle-1",
	pondId: "pond-a",
	label: "Cycle A",
	status: "ACTIVE",
	stockingDate: "2026-09-01",
	stockingCount: 1000,
	deadCount: 50,
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
	cycle: CropCycleDto | null;
}

function renderForm(overrides: Partial<FormProps> = {}) {
	const onClose = vi.fn();
	const onSaved = vi.fn();
	let props: FormProps = { open: true, cycle, ...overrides };
	const element = () => <HarvestForm onClose={onClose} onSaved={onSaved} {...props} />;
	const view = render(element());
	const rerenderForm = (next: Partial<FormProps> = {}) => {
		props = { ...props, ...next };
		view.rerender(element());
	};
	return { ...view, rerenderForm, onClose, onSaved };
}

describe("HarvestForm under live refresh (#825)", () => {
	it("keeps typed values when cycle arrives as a new deep-equal object", () => {
		const { rerenderForm } = renderForm();

		expect(screen.getByLabelText("Fish harvested")).toHaveValue(950);
		fireEvent.change(screen.getByLabelText("Total harvested weight (kg)"), {
			target: { value: "12.5" },
		});
		fireEvent.change(screen.getByLabelText("Fish harvested"), { target: { value: "900" } });
		fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Buyer: local" } });

		rerenderForm({ cycle: { ...cycle } });

		expect(screen.getByLabelText("Total harvested weight (kg)")).toHaveValue(12.5);
		expect(screen.getByLabelText("Fish harvested")).toHaveValue(900);
		expect(screen.getByLabelText("Notes")).toHaveValue("Buyer: local");
	});

	it("does not reset the count when mortality changes mid-edit", () => {
		const { rerenderForm } = renderForm();

		fireEvent.change(screen.getByLabelText("Fish harvested"), { target: { value: "900" } });

		rerenderForm({ cycle: { ...cycle, deadCount: 100 } });

		expect(screen.getByLabelText("Fish harvested")).toHaveValue(900);
	});

	it("re-initialises after the dialog is closed and reopened", () => {
		const { rerenderForm } = renderForm();

		fireEvent.change(screen.getByLabelText("Total harvested weight (kg)"), {
			target: { value: "12.5" },
		});
		fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Draft" } });

		rerenderForm({ open: false });
		rerenderForm({ open: true });

		expect(screen.getByLabelText("Total harvested weight (kg)")).toHaveValue(null);
		expect(screen.getByLabelText("Notes")).toHaveValue("");
		expect(screen.getByLabelText("Fish harvested")).toHaveValue(950);
	});

	it("re-initialises when a different cycle is selected", () => {
		const { rerenderForm } = renderForm();

		fireEvent.change(screen.getByLabelText("Total harvested weight (kg)"), {
			target: { value: "12.5" },
		});

		rerenderForm({
			cycle: { ...cycle, id: "cycle-2", stockingCount: 2000, deadCount: 0 },
		});

		expect(screen.getByLabelText("Total harvested weight (kg)")).toHaveValue(null);
		expect(screen.getByLabelText("Fish harvested")).toHaveValue(2000);
	});
});
