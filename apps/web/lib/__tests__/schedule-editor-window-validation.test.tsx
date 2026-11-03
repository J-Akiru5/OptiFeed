import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * #763 — the editor accepted start === end with several feeds, produced N
 * identical preview slots and offered no warning when edits were lost.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/lib/actions/schedule", () => ({
	updateScheduleCommand: vi.fn(),
}));

import { ScheduleEditor } from "@/components/ScheduleEditor";
import { updateScheduleCommand } from "@/lib/actions/schedule";

const updateScheduleCommandMock = vi.mocked(updateScheduleCommand);

function renderEditor() {
	return render(
		<ScheduleEditor
			pondId="pond-1"
			deviceId="device-1"
			initialStart="06:00"
			initialEnd="18:00"
			initialFeedsPerDay={4}
			initialFeedingRatePct={5}
			pendingCommand={null}
			latestAppliedCommand={null}
		/>,
	);
}

const WINDOW_ERROR =
	"The first and last feed cannot be the same time when feeding more than once a day.";

describe("ScheduleEditor feeding window validation (#763)", () => {
	it("rejects a zero-length window with more than one feed inline", () => {
		renderEditor();

		fireEvent.change(screen.getByLabelText("Last feed time"), { target: { value: "06:00" } });

		expect(screen.getByRole("alert")).toHaveTextContent(WINDOW_ERROR);
		expect(screen.getByLabelText("First feed time")).toHaveAttribute("aria-invalid", "true");
		expect(screen.getByLabelText("Last feed time")).toHaveAttribute("aria-invalid", "true");
		expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
	});

	it("does not submit the invalid window", () => {
		renderEditor();

		fireEvent.change(screen.getByLabelText("Last feed time"), { target: { value: "06:00" } });
		const form = screen.getByRole("button", { name: "Save Changes" }).closest("form");
		if (!form) throw new Error("form not found");
		fireEvent.submit(form);

		expect(updateScheduleCommandMock).not.toHaveBeenCalled();
	});

	it("allows a single feed at one time", () => {
		renderEditor();

		fireEvent.change(screen.getByLabelText("Feeds Per Day"), { target: { value: "1" } });
		fireEvent.change(screen.getByLabelText("Last feed time"), { target: { value: "06:00" } });

		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
	});

	it("marks the draft as unsaved and arms the unload warning", () => {
		const addEventListener = vi.spyOn(window, "addEventListener");
		renderEditor();

		expect(screen.queryByText("You have unsaved changes.")).not.toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("Feeding Rate (%)"), { target: { value: "6" } });

		expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
		expect(addEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));

		addEventListener.mockRestore();
	});
});
