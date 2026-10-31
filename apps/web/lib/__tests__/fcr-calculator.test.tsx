import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
