import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #751 — the biomass result panel always drew a green check and the "Feed to
 * dispense per feeding" headline, even when the server rejected or skipped the
 * calculation. It also queued any thrown save into the offline outbox, and a
 * rapid double-click while offline could enqueue the same sample twice.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

vi.mock("@/i18n/routing", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const { saveBiomassLog, enqueueBiomassSample, newClientEventId } = vi.hoisted(() => ({
	saveBiomassLog: vi.fn(),
	enqueueBiomassSample: vi.fn(async () => true),
	newClientEventId: vi.fn(),
}));

vi.mock("@/lib/actions/biomass", () => ({ saveBiomassLog }));
vi.mock("@/lib/offline/outbox", () => ({ enqueueBiomassSample, newClientEventId }));
vi.mock("@/lib/pwa/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("@/components/mobile/form-actions", () => ({ mobileStickyActions: "" }));

import { LogSampleForm } from "@/components/LogSampleForm";
import { createTranslator } from "./helpers/messages";

const tLog = createTranslator("dashboard.logSample");
const tBtn = createTranslator("button");

function renderForm() {
	return render(
		<LogSampleForm pondId="pond-1" feedingRatePct={3} feedsPerDay={3} population={5000} />,
	);
}

function fillAverageSample() {
	fireEvent.change(screen.getByLabelText(tLog("weightInputLabel")), { target: { value: "220" } });
	fireEvent.change(screen.getByLabelText(tLog("lengthLabel")), { target: { value: "24" } });
}

function submit() {
	fireEvent.click(screen.getByRole("button", { name: tBtn("saveSample") }));
}

const baseFeed = {
	calculatedGrams: 90,
	effectiveGrams: 30,
	previousGrams: 30,
	dailyFeedG: 270,
	feedsPerDay: 3,
	feedingRatePct: 3,
	population: 5000,
	deviceOffline: false,
	batchLabel: null,
};

beforeEach(() => {
	let counter = 0;
	newClientEventId.mockImplementation(() => `event-${++counter}`);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("biomass result status (#751)", () => {
	it("does not present a rejected calculation as an applied feed", async () => {
		saveBiomassLog.mockResolvedValue({
			success: true,
			feed: { ...baseFeed, status: "rejected_deviation" },
		});
		renderForm();
		fillAverageSample();
		submit();

		expect(await screen.findByText(tLog("resultRejectedTitle"))).toBeInTheDocument();
		expect(screen.queryByText(tLog("feedPerFeeding"))).not.toBeInTheDocument();
		expect(
			screen.getByText(
				tLog("statusRejectedDeviation", {
					previous: 30,
					calculated: 90,
				}),
			),
		).toBeInTheDocument();
	});

	it("keeps the green success headline when the schedule was updated", async () => {
		saveBiomassLog.mockResolvedValue({
			success: true,
			feed: { ...baseFeed, status: "updated" },
		});
		renderForm();
		fillAverageSample();
		submit();

		expect(await screen.findByText(tLog("feedPerFeeding"))).toBeInTheDocument();
		expect(screen.queryByText(tLog("resultRejectedTitle"))).not.toBeInTheDocument();
	});

	it("labels a skipped calculation as no schedule update", async () => {
		saveBiomassLog.mockResolvedValue({
			success: true,
			feed: { ...baseFeed, status: "skipped_no_device", calculatedGrams: null },
		});
		renderForm();
		fillAverageSample();
		submit();

		expect(await screen.findByText(tLog("resultSkippedTitle"))).toBeInTheDocument();
		expect(screen.queryByText(tLog("feedPerFeeding"))).not.toBeInTheDocument();
	});

	it("queues a transport failure but not an application error", async () => {
		saveBiomassLog.mockRejectedValue(new Error("Only the owner can log samples"));
		renderForm();
		fillAverageSample();
		submit();

		expect(await screen.findByText(tLog("errorSaveFailed"))).toBeInTheDocument();
		expect(enqueueBiomassSample).not.toHaveBeenCalled();
	});

	it("enqueues a network failure once", async () => {
		saveBiomassLog.mockRejectedValue(new TypeError("Failed to fetch"));
		renderForm();
		fillAverageSample();
		submit();

		await waitFor(() => expect(enqueueBiomassSample).toHaveBeenCalledTimes(1));
	});

	it("does not enqueue twice when the save button is double-clicked offline", async () => {
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
		renderForm();
		fillAverageSample();

		const form = screen.getByRole("button", { name: tBtn("saveSample") }).closest("form");
		if (!form) throw new Error("form not found");

		await act(async () => {
			fireEvent.submit(form);
			fireEvent.submit(form);
		});

		expect(enqueueBiomassSample).toHaveBeenCalledTimes(1);
		expect(saveBiomassLog).not.toHaveBeenCalled();
	});
});
