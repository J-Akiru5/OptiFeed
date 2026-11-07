import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
	};
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/fcr", () => ({ calculateFcrFeed: vi.fn() }));
vi.mock("@/lib/actions/growth-target", () => ({ setGrowthTarget: vi.fn() }));

import { FcrCalculator } from "@/components/FcrCalculator";
import { calculateFcrFeed } from "@/lib/actions/fcr";
import { setGrowthTarget } from "@/lib/actions/growth-target";

const calculate = vi.mocked(calculateFcrFeed);
const saveTarget = vi.mocked(setGrowthTarget);

const calculation = {
	success: true as const,
	totalFeedNeededKg: 100,
	dailyFeedRationKg: 5,
	totalBiomassGainKg: 50,
	dailyBiomassGainKg: 2.5,
	suggestedFeedingRatePct: 3,
	gramsPerFeeding: 500,
	daysToTarget: 60,
	latestFcr: 1.5,
	fcrSource: "computed" as const,
};

function fillAndCalculate() {
	fireEvent.change(screen.getByLabelText("Current average weight (kg)"), {
		target: { value: "0.1" },
	});
	fireEvent.change(screen.getByLabelText("Target Weight (kg)"), { target: { value: "0.4" } });
	fireEvent.change(screen.getByLabelText("Days to Target"), { target: { value: "60" } });
	fireEvent.click(screen.getByRole("button", { name: "Calculate Feed Requirement" }));
}

beforeEach(() => {
	calculate.mockReset();
	saveTarget.mockReset();
	vi.mocked(toast.error).mockClear();
	calculate.mockResolvedValue(calculation);
	saveTarget.mockResolvedValue({ success: true });
});

describe("FcrCalculator growth target", () => {
	it("saves the calculated target for the pond and its population", async () => {
		render(<FcrCalculator latestFcr={1.5} pondId="pond-a" population={1000} canSetTarget />);

		fillAndCalculate();
		const button = await screen.findByRole("button", { name: /Set as growth target/ });
		fireEvent.click(button);

		await waitFor(() => {
			expect(saveTarget).toHaveBeenCalledWith("pond-a", {
				targetWeightKg: 0.4,
				population: 1000,
			});
		});
		expect(await screen.findByText("Saved target: 0.4 kg at harvest.")).toBeInTheDocument();
	});

	it("disables the action until the pond has an active cycle", async () => {
		render(
			<FcrCalculator latestFcr={1.5} pondId="pond-a" population={1000} canSetTarget={false} />,
		);

		fillAndCalculate();
		const button = await screen.findByRole("button", { name: /Set as growth target/ });

		expect(button).toBeDisabled();
		expect(
			screen.getByText("Start a grow-out cycle before setting a growth target."),
		).toBeInTheDocument();
		expect(saveTarget).not.toHaveBeenCalled();
	});
});

describe("weight unit (#683)", () => {
	it("labels the unit control and re-labels every weight field when it changes", () => {
		render(<FcrCalculator latestFcr={1.5} pondId="pond-a" population={1000} />);

		const unitSelect = screen.getByLabelText("Weight unit") as HTMLSelectElement;
		expect(unitSelect.value).toBe("kg");
		expect(screen.getByLabelText("Current average weight (kg)")).toBeInTheDocument();
		expect(screen.getByLabelText("Target Weight (kg)")).toBeInTheDocument();

		fireEvent.change(unitSelect, { target: { value: "g" } });

		expect(unitSelect.value).toBe("g");
		expect(screen.getByLabelText("Current average weight (g)")).toBeInTheDocument();
		expect(screen.getByLabelText("Target Weight (g)")).toBeInTheDocument();
	});

	it("round-trips 1.5 kg to 1500 g and back without drift", () => {
		render(<FcrCalculator latestFcr={1.5} pondId="pond-a" population={1000} />);

		fireEvent.change(screen.getByLabelText("Current average weight (kg)"), {
			target: { value: "1.5" },
		});
		fireEvent.change(screen.getByLabelText("Weight unit"), { target: { value: "g" } });

		const grams = screen.getByLabelText("Current average weight (g)") as HTMLInputElement;
		expect(grams.value).toBe("1500");

		fireEvent.change(screen.getByLabelText("Weight unit"), { target: { value: "kg" } });

		const kilograms = screen.getByLabelText("Current average weight (kg)") as HTMLInputElement;
		expect(kilograms.value).toBe("1.5");
	});

	it("sends kilograms even when the operator enters grams", async () => {
		render(<FcrCalculator latestFcr={1.5} pondId="pond-a" population={1000} />);

		fireEvent.change(screen.getByLabelText("Weight unit"), { target: { value: "g" } });
		fireEvent.change(screen.getByLabelText("Current average weight (g)"), {
			target: { value: "150" },
		});
		fireEvent.change(screen.getByLabelText("Target Weight (g)"), { target: { value: "400" } });
		fireEvent.change(screen.getByLabelText("Days to Target"), { target: { value: "60" } });
		fireEvent.click(screen.getByRole("button", { name: "Calculate Feed Requirement" }));

		await waitFor(() => expect(calculate).toHaveBeenCalled());
		expect(calculate).toHaveBeenCalledWith(
			expect.objectContaining({ currentWeightKg: 0.15, targetWeightKg: 0.4 }),
		);
	});

	it("renders results in the selected unit and keeps gramsPerFeeding in grams", async () => {
		render(<FcrCalculator latestFcr={1.5} pondId="pond-a" population={1000} />);

		fireEvent.change(screen.getByLabelText("Weight unit"), { target: { value: "g" } });
		fireEvent.change(screen.getByLabelText("Current average weight (g)"), {
			target: { value: "150" },
		});
		fireEvent.change(screen.getByLabelText("Target Weight (g)"), { target: { value: "400" } });
		fireEvent.change(screen.getByLabelText("Days to Target"), { target: { value: "60" } });
		fireEvent.click(screen.getByRole("button", { name: "Calculate Feed Requirement" }));

		expect(await screen.findByText("100000 g")).toBeInTheDocument();
		expect(screen.getByText("5000 g")).toBeInTheDocument();
		expect(screen.getByText("50000 g")).toBeInTheDocument();
		expect(screen.getByText("Per meal: 500 g")).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("Weight unit"), { target: { value: "kg" } });

		expect(screen.getByText("100 kg")).toBeInTheDocument();
		expect(screen.getByText("5 kg")).toBeInTheDocument();
		expect(screen.getByText("50 kg")).toBeInTheDocument();
		// The per-meal dose stays in grams in every unit.
		expect(screen.getByText("Per meal: 500 g")).toBeInTheDocument();
	});

	it("keeps kilogram results unchanged when the unit stays kg", async () => {
		render(<FcrCalculator latestFcr={1.5} pondId="pond-a" population={1000} />);

		fillAndCalculate();

		expect(await screen.findByText("100 kg")).toBeInTheDocument();
		expect(screen.getByText("5 kg")).toBeInTheDocument();
		expect(screen.getByText("50 kg")).toBeInTheDocument();
		expect(calculate).toHaveBeenCalledWith(
			expect.objectContaining({ currentWeightKg: 0.1, targetWeightKg: 0.4 }),
		);
	});

	it("never sends or renders NaN for blank or zero weights", async () => {
		render(<FcrCalculator latestFcr={1.5} pondId="pond-a" population={1000} />);

		fireEvent.change(screen.getByLabelText("Target Weight (kg)"), { target: { value: "0.4" } });
		fireEvent.change(screen.getByLabelText("Days to Target"), { target: { value: "60" } });
		const calculateButton = screen.getByRole("button", { name: "Calculate Feed Requirement" });
		fireEvent.click(calculateButton);

		await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

		fireEvent.change(screen.getByLabelText("Current average weight (kg)"), {
			target: { value: "0" },
		});
		fireEvent.click(calculateButton);

		await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
		expect(calculate).not.toHaveBeenCalled();
		expect(screen.queryByText(/NaN/)).toBeNull();
	});
});
