import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The button-dose control (issue #658).
 *
 * The input must refuse values outside the firmware's 1-5,000 g window before a
 * request is made, and the block underneath must show what the DEVICE reported
 * so a saved-but-unapplied change is visible rather than implied to have worked.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
	};
});

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ButtonFeedForm, type ButtonFeedFormReport } from "@/components/ButtonFeedForm";

interface SaveResult {
	success: boolean;
	error?: string;
	buttonFeedGrams?: number;
}

function makeReport(overrides: Partial<ButtonFeedFormReport> = {}): ButtonFeedFormReport {
	return {
		storedGrams: 80,
		lastPressGrams: null,
		lastPressAtLabel: null,
		confirmation: "no_change",
		...overrides,
	};
}

function renderForm(
	options: { report?: ButtonFeedFormReport; canWrite?: boolean; result?: SaveResult } = {},
) {
	const {
		report = makeReport(),
		canWrite = true,
		result = { success: true, buttonFeedGrams: 120 },
	} = options;
	const saveAction = vi.fn(async (_deviceId: string, _grams: number) => result);
	render(
		<ButtonFeedForm deviceId="dev-1" report={report} saveAction={saveAction} canWrite={canWrite} />,
	);
	return { saveAction };
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ButtonFeedForm", () => {
	it("starts from the stored dose and saves the typed value", async () => {
		const { saveAction } = renderForm({ report: makeReport({ storedGrams: 80 }) });

		const input = screen.getByLabelText("Dose per press (g)");
		expect(input).toHaveValue(80);

		fireEvent.change(input, { target: { value: "120" } });
		expect(screen.getByText("Not saved yet.")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Save button dose" }));

		await waitFor(() => expect(saveAction).toHaveBeenCalledWith("dev-1", 120));
		expect(
			await screen.findByText("Button dose saved. The device confirms it after its next poll."),
		).toBeInTheDocument();
		expect(refresh).toHaveBeenCalled();
		expect(screen.queryByText("Not saved yet.")).not.toBeInTheDocument();
	});

	it("shows the value the server stored, not only the typed one", async () => {
		const { saveAction } = renderForm({
			report: makeReport({ storedGrams: 80 }),
			result: { success: true, buttonFeedGrams: 121 },
		});

		const input = screen.getByLabelText("Dose per press (g)");
		fireEvent.change(input, { target: { value: "120.5" } });
		fireEvent.click(screen.getByRole("button", { name: "Save button dose" }));

		await waitFor(() => expect(saveAction).toHaveBeenCalledWith("dev-1", 120.5));
		expect(input).toHaveValue(121);
	});

	it("steps by 1 g and accepts two decimals", () => {
		renderForm({ report: makeReport({ storedGrams: 80 }) });

		const input = screen.getByLabelText("Dose per press (g)");
		expect(input).toHaveAttribute("step", "1");
		expect(input).toHaveAttribute("inputMode", "decimal");

		fireEvent.click(screen.getByRole("button", { name: "Increase Dose per press (g)" }));
		expect(input).toHaveValue(81);
		fireEvent.click(screen.getByRole("button", { name: "Decrease Dose per press (g)" }));
		expect(input).toHaveValue(80);

		fireEvent.change(input, { target: { value: "80.25" } });
		expect(input).toHaveValue(80.25);
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("refuses a dose outside the firmware's 1-5,000 g window before the call", () => {
		const { saveAction } = renderForm({ report: makeReport({ storedGrams: 80 }) });

		const input = screen.getByLabelText("Dose per press (g)");
		const save = screen.getByRole("button", { name: "Save button dose" });

		fireEvent.change(input, { target: { value: "0.5" } });
		expect(screen.getByRole("alert")).toHaveTextContent("Enter a value from 1 to 5000.");
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(save).toBeDisabled();
		fireEvent.click(save);
		expect(saveAction).not.toHaveBeenCalled();

		fireEvent.change(input, { target: { value: "5001" } });
		expect(screen.getByRole("alert")).toHaveTextContent("Enter a value from 1 to 5000.");
		expect(save).toBeDisabled();

		fireEvent.change(input, { target: { value: "5000" } });
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(save).toBeEnabled();

		fireEvent.change(input, { target: { value: "1" } });
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(save).toBeEnabled();
	});

	it("rejects more than two decimal places", () => {
		renderForm();

		fireEvent.change(screen.getByLabelText("Dose per press (g)"), {
			target: { value: "80.255" },
		});

		expect(screen.getByRole("alert")).toHaveTextContent("Use at most 2 decimal places.");
	});

	it("shows the press the device reported when the change is not confirmed", () => {
		renderForm({
			report: makeReport({
				storedGrams: 120,
				lastPressGrams: 80,
				lastPressAtLabel: "Tue, Nov 3 • 2:05 PM",
				confirmation: "unconfirmed",
			}),
		});

		expect(
			screen.getByText("Last button press: 80 g at Tue, Nov 3 • 2:05 PM."),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"Not confirmed: the last press reported 80 g at Tue, Nov 3 • 2:05 PM, so the saved amount is not on the device yet.",
			),
		).toBeInTheDocument();
		expect(
			screen.queryByText("Confirmed: the device reported this amount after the change."),
		).not.toBeInTheDocument();
	});

	it("says so when the device has not reported a press since the change", () => {
		renderForm({ report: makeReport({ confirmation: "no_press" }) });

		expect(
			screen.getByText("Not confirmed: the device has not reported a press since this change."),
		).toBeInTheDocument();
		expect(
			screen.queryByText("No button press has been reported for this device."),
		).not.toBeInTheDocument();
	});

	it("shows a confirmed change", () => {
		renderForm({
			report: makeReport({
				storedGrams: 120,
				lastPressGrams: 120,
				lastPressAtLabel: "Tue, Nov 3 • 2:05 PM",
				confirmation: "confirmed",
			}),
		});

		expect(
			screen.getByText("Confirmed: the device reported this amount after the change."),
		).toBeInTheDocument();
	});

	it("does not claim there is no press when the report could not be read", () => {
		renderForm({ report: makeReport({ confirmation: "unavailable" }) });

		expect(
			screen.getByText("The device's button-press reports could not be read."),
		).toBeInTheDocument();
		expect(
			screen.queryByText("No button press has been reported for this device."),
		).not.toBeInTheDocument();
	});

	it("shows a refused save with role=alert and does not mark it saved", async () => {
		renderForm({
			result: { success: false, error: "Device not found" },
		});

		fireEvent.click(screen.getByRole("button", { name: "Save button dose" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("Device not found");
		expect(
			screen.queryByText("Button dose saved. The device confirms it after its next poll."),
		).not.toBeInTheDocument();
		expect(refresh).not.toHaveBeenCalled();
	});

	it("disables the field and save action without write permission", () => {
		renderForm({ canWrite: false });

		expect(screen.getByLabelText("Dose per press (g)")).toBeDisabled();
		expect(screen.getByRole("button", { name: "Save button dose" })).toBeDisabled();
	});
});
