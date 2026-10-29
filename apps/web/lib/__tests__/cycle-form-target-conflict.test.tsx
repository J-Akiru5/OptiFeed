import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D-2: editing the cycle target while the pond has a saved calculator target
 * must ask before saving, and both answers must produce the documented state.
 * The server half of each answer is covered in crop-cycle-actions.test.ts.
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
import { updateCropCycle } from "@/lib/actions/crop-cycle";
import type { CropCycleDto, PondOption } from "@/lib/crop-cycle/types";

const update = vi.mocked(updateCropCycle);

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

const pond: PondOption = {
	id: "pond-a",
	name: "Pond A",
	isFallow: false,
	population: 1000,
	areaM2: 100,
	averageDepthM: 1.5,
	savedTargetWeightG: 400,
};

function renderForm(savedTargetWeightG: number | null = 400) {
	const onClose = vi.fn();
	const onSaved = vi.fn();
	render(
		<CycleForm
			open
			onClose={onClose}
			onSaved={onSaved}
			ponds={[{ ...pond, savedTargetWeightG }]}
			initialPondId="pond-a"
			cycle={cycle}
		/>,
	);
	return { onClose, onSaved };
}

function editTarget(value: string) {
	fireEvent.change(screen.getByLabelText("Target weight (g)"), { target: { value } });
	fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
}

beforeEach(() => {
	update.mockReset();
	update.mockResolvedValue({ success: true, cycleId: "cycle-1" });
});

describe("CycleForm saved-target confirmation (D-2)", () => {
	it("asks before saving and announces the choice accessibly", async () => {
		renderForm(400);

		editTarget("300");

		const alert = await screen.findByRole("alertdialog");
		expect(alert).toHaveAttribute("aria-labelledby");
		expect(alert).toHaveAttribute("aria-describedby");
		expect(alert).toHaveTextContent("A saved calculator target already exists");
		expect(alert).toHaveTextContent(
			"The plan for this pond uses 400.0 g from the feed calculator. You changed the cycle target to 300.0 g.",
		);
		await waitFor(() => expect(alert).toHaveFocus());
		expect(update).not.toHaveBeenCalled();
	});

	it("replace submits the new cycle value with the replace choice", async () => {
		renderForm(400);

		editTarget("300");
		await screen.findByRole("alertdialog");
		fireEvent.click(screen.getByRole("button", { name: "Replace calculator target" }));

		await waitFor(() => {
			expect(update).toHaveBeenCalledWith(
				"cycle-1",
				expect.objectContaining({ targetHarvestWeightG: 300 }),
				{ growthTargetResolution: "replace" },
			);
		});
	});

	it("keep submits the keep choice and explains the plan keeps the saved value", async () => {
		renderForm(400);

		editTarget("300");
		await screen.findByRole("alertdialog");
		const keep = screen.getByRole("button", { name: "Keep calculator target" });
		fireEvent.click(keep);

		await waitFor(() => {
			expect(update).toHaveBeenCalledWith(
				"cycle-1",
				expect.objectContaining({ targetHarvestWeightG: 300 }),
				{ growthTargetResolution: "keep" },
			);
		});
	});

	it("cancelling the confirmation cancels the save", async () => {
		renderForm(400);

		editTarget("300");
		const alert = await screen.findByRole("alertdialog");
		fireEvent.click(within(alert).getByRole("button", { name: "Cancel" }));

		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(update).not.toHaveBeenCalled();
	});

	it("offers to clear both when the cycle target is emptied", async () => {
		renderForm(400);

		editTarget("");
		const alert = await screen.findByRole("alertdialog");

		expect(alert).toHaveTextContent("You cleared the cycle target.");
		expect(alert).toHaveTextContent("Clear the calculator target and the cycle target.");
	});

	it("does not ask when the pond has no saved target", async () => {
		renderForm(null);

		editTarget("300");

		await waitFor(() => {
			expect(update).toHaveBeenCalledWith(
				"cycle-1",
				expect.objectContaining({ targetHarvestWeightG: 300 }),
			);
		});
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});

	it("does not ask when the target field was not edited", async () => {
		renderForm(400);

		fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

		await waitFor(() => {
			expect(update).toHaveBeenCalledWith(
				"cycle-1",
				expect.objectContaining({ targetHarvestWeightG: 250 }),
			);
		});
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});
});
