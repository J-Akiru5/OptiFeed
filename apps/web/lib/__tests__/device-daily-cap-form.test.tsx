import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * DeviceDailyCapForm now uses the shared calibration number field (issue #320).
 *
 * These checks pin the migration: the ceiling can be cleared and retyped like
 * every other calibration field, the stepper moves in 50 g increments, the
 * 500-5,000 g window is enforced, and the injected save action still receives
 * the parsed number.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
	};
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DeviceDailyCapForm } from "@/components/DeviceDailyCapForm";

interface SaveResult {
	success: boolean;
	error?: string;
	dailyCapG?: number;
}

function renderForm(
	options: {
		currentCapG?: number | null;
		canWrite?: boolean;
		result?: SaveResult;
	} = {},
) {
	const { currentCapG = 2000, canWrite = true, result = { success: true } } = options;
	const saveAction = vi.fn(async (_deviceId: string, _dailyCapG: number) => result);
	const { container } = render(
		<DeviceDailyCapForm
			deviceId="dev-1"
			currentCapG={currentCapG}
			saveAction={saveAction}
			canWrite={canWrite}
		/>,
	);
	return { saveAction, container };
}

afterEach(cleanup);

describe("DeviceDailyCapForm", () => {
	it("clears a stored ceiling and saves the retyped number (issue #307)", async () => {
		const { saveAction } = renderForm({ currentCapG: 2000 });

		const input = screen.getByLabelText("Ceiling (g/day)");
		expect(input).toHaveValue(2000);

		// The old numeric state ran Number("") → 0, which put the zero straight
		// back and made the field impossible to clear.
		fireEvent.change(input, { target: { value: "" } });
		expect(input).toHaveValue(null);

		fireEvent.change(input, { target: { value: "2500" } });
		expect(input).toHaveValue(2500);

		fireEvent.click(screen.getByRole("button", { name: "Save ceiling" }));

		await waitFor(() => expect(saveAction).toHaveBeenCalledWith("dev-1", 2500));
		expect(screen.getByText("Daily ceiling saved.")).toBeInTheDocument();
	});

	it("steps the ceiling by 50 g and saves the stepped value", async () => {
		const { saveAction } = renderForm({ currentCapG: 1000 });

		const input = screen.getByLabelText("Ceiling (g/day)");
		const increase = screen.getByRole("button", { name: "Increase Ceiling (g/day)" });
		const decrease = screen.getByRole("button", { name: "Decrease Ceiling (g/day)" });

		expect(input).toHaveAttribute("step", "50");
		expect(input).toHaveAttribute("inputMode", "numeric");

		fireEvent.click(increase);
		expect(input).toHaveValue(1050);
		fireEvent.click(increase);
		expect(input).toHaveValue(1100);
		fireEvent.click(decrease);
		expect(input).toHaveValue(1050);

		fireEvent.click(screen.getByRole("button", { name: "Save ceiling" }));

		await waitFor(() => expect(saveAction).toHaveBeenCalledWith("dev-1", 1050));
	});

	it("enforces the 500-5,000 g window and links the message", () => {
		const { saveAction } = renderForm({ currentCapG: 2000 });

		const input = screen.getByLabelText("Ceiling (g/day)");
		const save = screen.getByRole("button", { name: "Save ceiling" });

		fireEvent.change(input, { target: { value: "499" } });
		const belowMin = screen.getByRole("alert");
		expect(belowMin).toHaveTextContent("Enter a value from 500 to 5000.");
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(input.getAttribute("aria-describedby")).toContain(belowMin.id);
		expect(save).toBeDisabled();

		fireEvent.change(input, { target: { value: "5001" } });
		expect(screen.getByRole("alert")).toHaveTextContent("Enter a value from 500 to 5000.");
		expect(save).toBeDisabled();
		fireEvent.click(save);
		expect(saveAction).not.toHaveBeenCalled();

		fireEvent.change(input, { target: { value: "500" } });
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(input).not.toHaveAttribute("aria-invalid");
		expect(save).toBeEnabled();
	});

	it("rejects a fractional ceiling", () => {
		renderForm({ currentCapG: 2000 });

		fireEvent.change(screen.getByLabelText("Ceiling (g/day)"), {
			target: { value: "2000.5" },
		});

		expect(screen.getByRole("alert")).toHaveTextContent("Use whole numbers only.");
	});

	it("uses the 2,000 g default when no ceiling is stored", async () => {
		const { saveAction } = renderForm({ currentCapG: null });

		const input = screen.getByLabelText("Ceiling (g/day)");
		expect(input).toHaveValue(2000);

		fireEvent.click(screen.getByRole("button", { name: "Save ceiling" }));

		await waitFor(() => expect(saveAction).toHaveBeenCalledWith("dev-1", 2000));
	});

	it("shows a failed save with role=alert and does not mark it saved", async () => {
		const { saveAction } = renderForm({
			currentCapG: 2000,
			result: { success: false, error: "Could not save the daily ceiling." },
		});

		fireEvent.click(screen.getByRole("button", { name: "Save ceiling" }));

		await waitFor(() => expect(saveAction).toHaveBeenCalledWith("dev-1", 2000));
		expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the daily ceiling.");
		expect(screen.queryByText("Daily ceiling saved.")).not.toBeInTheDocument();
	});

	it("disables the field and save action without write permission", () => {
		renderForm({ currentCapG: 2000, canWrite: false });

		expect(screen.getByLabelText("Ceiling (g/day)")).toBeDisabled();
		expect(screen.getByRole("button", { name: "Save ceiling" })).toBeDisabled();
	});

	it("lays the ceiling field out in the shared calibration grid", () => {
		const { container } = renderForm();

		const grid = container.querySelector("div.grid");
		expect(grid).not.toBeNull();
		expect(grid).toHaveClass("grid-cols-1", "sm:grid-cols-2", "xl:grid-cols-3");
	});
});
