import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const actionMocks = vi.hoisted(() => ({ saveBiomassLog: vi.fn() }));

vi.mock("@/lib/actions/biomass", () => ({
	saveBiomassLog: actionMocks.saveBiomassLog,
}));

vi.mock("@/lib/offline/outbox", () => ({
	enqueueBiomassSample: vi.fn(),
	newClientEventId: () => "offline-test-id",
}));

vi.mock("@/lib/pwa/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("@/components/mobile/form-actions", () => ({ mobileStickyActions: "" }));

import { LogSampleForm } from "@/components/LogSampleForm";

beforeEach(() => {
	vi.clearAllMocks();
});

function feed(status: string, overrides: Record<string, unknown> = {}) {
	return {
		calculatedGrams: 182.4,
		effectiveGrams: 182.4,
		previousGrams: 150,
		dailyFeedG: 547.2,
		feedsPerDay: 3,
		feedingRatePct: 3,
		population: 5000,
		status,
		deviceOffline: false,
		batchLabel: "Batch A",
		...overrides,
	};
}

function renderAndSubmit() {
	render(<LogSampleForm pondId="pond-1" feedingRatePct={3} feedsPerDay={3} population={5000} />);
	fireEvent.change(screen.getByLabelText("Avg. Fish Weight (grams)"), {
		target: { value: "220" },
	});
	fireEvent.change(screen.getByLabelText("Avg. Fish Length (cm)"), {
		target: { value: "24" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save Sample" }));
}

describe("biomass result status (#751)", () => {
	it("uses a green applied state only when the device schedule was updated", async () => {
		actionMocks.saveBiomassLog.mockResolvedValue({ success: true, feed: feed("updated") });

		renderAndSubmit();

		await waitFor(() => {
			expect(screen.getByTestId("biomass-result-icon")).toHaveAttribute("data-status", "updated");
		});
		expect(screen.getByTestId("biomass-result-icon").className).toContain("bg-green-100");
		expect(screen.getByText("Feed to dispense per feeding")).toBeInTheDocument();
	});

	it("states that the schedule was not changed when the recommendation is rejected", async () => {
		actionMocks.saveBiomassLog.mockResolvedValue({
			success: true,
			feed: feed("rejected_deviation"),
		});

		renderAndSubmit();

		await waitFor(() => {
			expect(screen.getByText("Device schedule not changed")).toBeInTheDocument();
		});
		expect(screen.getByText("The feeder keeps its current schedule and dose.")).toBeInTheDocument();
		expect(screen.queryByText("Feed to dispense per feeding")).not.toBeInTheDocument();
		expect(screen.getByTestId("biomass-result-icon").className).toContain("bg-amber-100");
	});

	it("keeps a skipped status neutral and explains the missing device", async () => {
		actionMocks.saveBiomassLog.mockResolvedValue({
			success: true,
			feed: feed("skipped_no_device", {
				calculatedGrams: null,
				effectiveGrams: null,
				dailyFeedG: null,
			}),
		});

		renderAndSubmit();

		await waitFor(() => {
			expect(screen.getByText("Device schedule not changed")).toBeInTheDocument();
		});
		expect(
			screen.getByText("Device schedule unchanged - no device is linked to this pond."),
		).toBeInTheDocument();
	});
});
