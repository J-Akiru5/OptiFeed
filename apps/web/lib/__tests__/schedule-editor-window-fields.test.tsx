import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/lib/actions/schedule", () => ({
	updateScheduleCommand: vi.fn(),
}));

import { ScheduleEditor } from "@/components/ScheduleEditor";

/**
 * Guards #483.
 *
 * Jeff read the derived "Feeding times" chips as a smart recommendation and
 * could not find where to set a time. The window fields are therefore labelled
 * as the first and last feed, live in the same card as the derived times, and
 * update those times as soon as they change. Frequency comes first so the
 * fields appear in the order the farmer thinks about the schedule.
 */

function renderEditor(overrides: Partial<React.ComponentProps<typeof ScheduleEditor>> = {}) {
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
			{...overrides}
		/>,
	);
}

function previewSlots() {
	return within(screen.getByTestId("preview-feed-times")).getAllByTestId("feed-time-slot");
}

function slotTexts() {
	return previewSlots().map((slot) => slot.textContent);
}

describe("ScheduleEditor feeding time fields (#483)", () => {
	it("shows labelled first/last feed fields and one time per meal at 4 feeds/day", () => {
		renderEditor();

		expect((screen.getByLabelText("First feed time") as HTMLInputElement).value).toBe("06:00");
		expect((screen.getByLabelText("Last feed time") as HTMLInputElement).value).toBe("18:00");
		expect(slotTexts()).toEqual(["6:00 AM", "10:00 AM", "2:00 PM", "6:00 PM"]);

		// The fields and the list are one section, not a recommendation card.
		const section = screen.getByTestId("feeding-times-preview");
		expect(within(section).getByText("Feeding times")).toBeTruthy();
		expect(within(section).getByText("4 times per day")).toBeTruthy();
		expect(
			within(section).getByText("Meals are spaced evenly between the first and last feed"),
		).toBeTruthy();
	});

	it("describes both time inputs with the even-spacing hint", () => {
		renderEditor();

		const hint = document.getElementById("feeding-window-hint");
		expect(hint?.textContent).toBe("Meals are spaced evenly between the first and last feed");
		for (const label of ["First feed time", "Last feed time"]) {
			const input = screen.getByLabelText(label);
			expect(input.getAttribute("aria-describedby")).toBe("feeding-window-hint");
		}
	});

	it("adds a time for every meal as the frequency changes", () => {
		renderEditor();

		expect(previewSlots()).toHaveLength(4);

		fireEvent.change(screen.getByLabelText("Feeds Per Day"), { target: { value: "3" } });
		expect(slotTexts()).toEqual(["6:00 AM", "12:00 PM", "6:00 PM"]);

		fireEvent.change(screen.getByLabelText("Feeds Per Day"), { target: { value: "2" } });
		expect(slotTexts()).toEqual(["6:00 AM", "6:00 PM"]);

		// The editable fields stay put while the meal count changes.
		expect(screen.getByLabelText("First feed time")).toBeTruthy();
		expect(screen.getByLabelText("Last feed time")).toBeTruthy();
	});

	it("moves the meal times as soon as the first or last feed is edited", () => {
		renderEditor();

		fireEvent.change(screen.getByLabelText("First feed time"), { target: { value: "05:00" } });
		expect(slotTexts()).toEqual(["5:00 AM", "9:20 AM", "1:40 PM", "6:00 PM"]);

		fireEvent.change(screen.getByLabelText("Last feed time"), { target: { value: "19:00" } });
		expect(slotTexts()).toEqual(["5:00 AM", "9:40 AM", "2:20 PM", "7:00 PM"]);
	});

	it("fills the fields and the times from the schedule the device runs", () => {
		renderEditor({ initialStart: "07:00", initialEnd: "17:00", initialFeedsPerDay: 2 });

		expect((screen.getByLabelText("First feed time") as HTMLInputElement).value).toBe("07:00");
		expect((screen.getByLabelText("Last feed time") as HTMLInputElement).value).toBe("17:00");
		expect(slotTexts()).toEqual(["7:00 AM", "5:00 PM"]);
	});
});
