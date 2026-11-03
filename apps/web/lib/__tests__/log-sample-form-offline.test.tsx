import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const actionMocks = vi.hoisted(() => ({ saveBiomassLog: vi.fn() }));
const outboxMocks = vi.hoisted(() => ({
	enqueueBiomassSample: vi.fn(),
	nextId: { value: 0 },
}));

vi.mock("@/lib/actions/biomass", () => ({
	saveBiomassLog: actionMocks.saveBiomassLog,
}));

vi.mock("@/lib/offline/outbox", () => ({
	enqueueBiomassSample: outboxMocks.enqueueBiomassSample,
	newClientEventId: () => `offline-test-${++outboxMocks.nextId.value}`,
}));

vi.mock("@/lib/pwa/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("@/components/mobile/form-actions", () => ({ mobileStickyActions: "" }));

import { LogSampleForm } from "@/components/LogSampleForm";

let onLineSpy: { mockRestore: () => void } | undefined;

beforeEach(() => {
	vi.clearAllMocks();
	outboxMocks.nextId.value = 0;
});

afterEach(() => {
	onLineSpy?.mockRestore();
	onLineSpy = undefined;
});

function renderForm() {
	return render(
		<LogSampleForm pondId="pond-1" feedingRatePct={3} feedsPerDay={3} population={5000} />,
	);
}

function fillAverageSample() {
	fireEvent.change(screen.getByLabelText("Avg. Fish Weight (grams)"), {
		target: { value: "220" },
	});
	fireEvent.change(screen.getByLabelText("Average Length (cm)"), {
		target: { value: "24" },
	});
}

function submit() {
	fireEvent.click(screen.getByRole("button", { name: "Save Sample" }));
}

describe("biomass save error handling (#751)", () => {
	it("shows a permission error instead of queueing the sample", async () => {
		actionMocks.saveBiomassLog.mockRejectedValue(new Error("Forbidden"));

		renderForm();
		fillAverageSample();
		submit();

		await waitFor(() => {
			expect(screen.getByText("Failed to save biomass log. Please try again.")).toBeInTheDocument();
		});
		expect(outboxMocks.enqueueBiomassSample).not.toHaveBeenCalled();
	});

	it("queues the sample only when the failure is a transport error", async () => {
		actionMocks.saveBiomassLog.mockRejectedValue(new TypeError("Failed to fetch"));
		outboxMocks.enqueueBiomassSample.mockResolvedValue(true);

		renderForm();
		fillAverageSample();
		submit();

		await waitFor(() => {
			expect(screen.getByText("Saved offline")).toBeInTheDocument();
		});
		expect(outboxMocks.enqueueBiomassSample).toHaveBeenCalledTimes(1);
	});

	it("does not create two outbox records from a double-click while offline", async () => {
		onLineSpy = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);

		let resolveQueue: ((queued: boolean) => void) | undefined;
		outboxMocks.enqueueBiomassSample.mockImplementation(
			() =>
				new Promise<boolean>((resolve) => {
					resolveQueue = resolve;
				}),
		);

		renderForm();
		fillAverageSample();
		submit();
		submit();

		await waitFor(() => {
			expect(outboxMocks.enqueueBiomassSample).toHaveBeenCalledTimes(1);
		});

		resolveQueue?.(true);
		await waitFor(() => {
			expect(screen.getByText("Saved offline")).toBeInTheDocument();
		});
	});
});
