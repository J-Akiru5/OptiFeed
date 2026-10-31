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
 * Guards #431: changing "Feeds Per Day" must change the rendered feeding times
 * immediately, and a saved-but-unapplied command must be shown as pending with
 * its own slot count instead of the last applied command's count.
 */

function renderEditor(overrides: Partial<React.ComponentProps<typeof ScheduleEditor>> = {}) {
	return render(
		<ScheduleEditor
			pondId="pond-1"
			deviceId="device-1"
			initialStart="06:00"
			initialEnd="18:00"
			initialFeedsPerDay={2}
			initialFeedingRatePct={5}
			pendingCommand={null}
			latestAppliedCommand={null}
			{...overrides}
		/>,
	);
}

function previewSlots() {
	return within(screen.getByTestId("feeding-times-preview")).getAllByTestId("feed-time-slot");
}

describe("ScheduleEditor feeding times (#431)", () => {
	it("adds a third slot as soon as the frequency changes from 2 to 3", () => {
		renderEditor();

		expect(previewSlots().map((slot) => slot.textContent)).toEqual(["6:00 AM", "6:00 PM"]);

		fireEvent.change(screen.getByLabelText("Feeds Per Day"), { target: { value: "3" } });

		expect(previewSlots().map((slot) => slot.textContent)).toEqual([
			"6:00 AM",
			"12:00 PM",
			"6:00 PM",
		]);
	});

	it("shows the pending command's slots with a pending marker after saving", () => {
		renderEditor({
			initialFeedsPerDay: 3,
			pendingCommand: {
				id: "cmd-3",
				status: "pending",
				scheduleStart: "06:00",
				scheduleEnd: "18:00",
				feedsPerDay: 3,
				feedingRatePct: 5,
				appliedAt: null,
				deviceTime: null,
			},
			latestAppliedCommand: {
				id: "cmd-2",
				status: "applied",
				scheduleStart: "06:00",
				scheduleEnd: "18:00",
				feedsPerDay: 2,
				feedingRatePct: 5,
				appliedAt: "2026-10-31T02:51:00.000Z",
				deviceTime: null,
			},
		});

		expect(screen.getByText("Pending device sync")).toBeTruthy();
		const pending = screen.getByTestId("pending-feed-times");
		expect(within(pending).getAllByTestId("feed-time-slot")).toHaveLength(3);
		// The last applied command must not steal the pending card.
		expect(screen.queryByTestId("applied-feed-times")).toBeNull();
	});

	it("keeps the last applied times labelled separately from the draft preview", () => {
		renderEditor({
			initialFeedsPerDay: 3,
			latestAppliedCommand: {
				id: "cmd-2",
				status: "applied",
				scheduleStart: "06:00",
				scheduleEnd: "18:00",
				feedsPerDay: 2,
				feedingRatePct: 5,
				appliedAt: "2026-10-31T02:51:00.000Z",
				deviceTime: null,
			},
		});

		expect(previewSlots()).toHaveLength(3);
		const applied = screen.getByTestId("applied-feed-times");
		expect(within(applied).getAllByTestId("feed-time-slot")).toHaveLength(2);
	});
});
