import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #348 — the calendar must name the item it is editing.
 *
 * `PondEvent` rows carry `itemKind` (`EVENT` = time range, `TASK` = due date
 * plus done checkbox). The details sheet and the editor are shared by both, so
 * every "edit/delete this event" label has to follow that kind. The old copy
 * said "Edit pond event" for a task, and the report was about the pond-sampling
 * task opening that sheet.
 */

const localeState = vi.hoisted(() => ({ locale: "en" as "en" | "hil" }));
const calendarState = vi.hoisted(() => ({
	events: [] as import("@/lib/crop-cycle/calendar").CalendarEventDto[],
}));

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace, localeState.locale),
		useLocale: () => localeState.locale,
	};
});

vi.mock("next/dynamic", () => ({
	// The grid is client-only; the sheets and rails are what we assert on.
	default: () => () => null,
}));

vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children }: { href: string; children?: ReactNode }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/api-client", () => ({
	apiGet: vi.fn(async () => ({ events: calendarState.events, truncated: false })),
	ApiClientError: class extends Error {},
}));

vi.mock("@/lib/actions/crop-cycle", () => ({
	cancelCropCycle: vi.fn(),
	updateCropCycle: vi.fn(),
	createCropCycle: vi.fn(),
	markCycleHarvested: vi.fn(),
}));

vi.mock("@/lib/actions/pond-event", () => ({
	completePondEvent: vi.fn(),
	uncompletePondEvent: vi.fn(),
	updatePondEvent: vi.fn(),
	createPondEvent: vi.fn(),
	deletePondEvent: vi.fn(),
}));

import { EventEditor } from "@/components/harvest/event-editor";
import { HarvestCalendar } from "@/components/harvest/harvest-calendar";
import type { CalendarEventDto } from "@/lib/crop-cycle/calendar";
import type { PondOption } from "@/lib/crop-cycle/types";

const pond: PondOption = {
	id: "pond-1",
	name: "Pond 1",
	isFallow: false,
	population: 1000,
	areaM2: 500,
	averageDepthM: 1.5,
	savedTargetWeightG: null,
};

const task: CalendarEventDto = {
	id: "pond:task-1:2026-10-26T00:00:00.000Z",
	pondEventId: "task-1",
	title: "Pond sampling",
	start: "2026-10-26",
	allDay: true,
	type: "sampling",
	kind: "SAMPLING",
	itemKind: "TASK",
	source: "manual",
	completed: false,
	editable: true,
	pondId: "pond-1",
	pondName: "Pond 1",
};

const event: CalendarEventDto = {
	id: "pond:event-1:2026-10-26T00:00:00.000Z",
	pondEventId: "event-1",
	title: "Water change",
	start: "2026-10-26",
	allDay: true,
	type: "manual",
	kind: "MAINTENANCE",
	itemKind: "EVENT",
	source: "manual",
	editable: true,
	pondId: "pond-1",
	pondName: "Pond 1",
};

function renderEditor(item: CalendarEventDto) {
	render(
		<EventEditor
			open
			onClose={vi.fn()}
			onSaved={vi.fn()}
			pondId="pond-1"
			ponds={[pond]}
			event={item}
		/>,
	);
}

function renderCalendar(item: CalendarEventDto) {
	calendarState.events = [item];
	render(
		<HarvestCalendar
			initialPondId="pond-1"
			initialPondName="Pond 1"
			initialPondIsFallow={false}
			ponds={[pond]}
			activeCycle={null}
			activeCycles={[]}
			recentCycles={[]}
			canManage
			today="2026-10-26"
		/>,
	);
}

beforeEach(() => {
	localeState.locale = "en";
	calendarState.events = [];
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("calendar item labels (#348)", () => {
	it("gives a task and an event different editor titles", () => {
		renderEditor(task);
		const taskDialog = screen.getByRole("dialog");
		const taskName = document.getElementById(
			taskDialog.getAttribute("aria-labelledby") ?? "",
		)?.textContent;
		cleanup();

		renderEditor(event);
		const eventDialog = screen.getByRole("dialog");
		const eventName = document.getElementById(
			eventDialog.getAttribute("aria-labelledby") ?? "",
		)?.textContent;

		expect(taskName).toBe("Edit task");
		expect(eventName).toBe("Edit pond event");
		expect(taskName).not.toBe(eventName);
	});

	it("uses task copy in the editor when the item is a task", () => {
		renderEditor(task);

		expect(screen.getByRole("dialog")).toHaveAccessibleName("Edit task");
		expect(screen.getByRole("button", { name: "Save task" })).toBeInTheDocument();
		expect(screen.getByText("Task type")).toBeInTheDocument();
	});

	it("uses event copy in the editor when the item is an event", () => {
		renderEditor(event);

		expect(screen.getByRole("dialog")).toHaveAccessibleName("Edit pond event");
		expect(screen.getByRole("button", { name: "Save event" })).toBeInTheDocument();
		expect(screen.getByText("Event type")).toBeInTheDocument();
	});

	it("confirms a task deletion as a task", () => {
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
		renderEditor(task);

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		expect(confirm).toHaveBeenCalledWith("Delete this task?");
	});

	it("asks for the whole series without calling a recurring task an event", () => {
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
		renderEditor({ ...task, recurrenceFreq: "WEEKLY", recurrenceInterval: 1 });
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		expect(confirm).toHaveBeenCalledWith(
			"Delete this whole series? Every occurrence will be removed.",
		);
	});

	it("labels the details sheet's edit action by item kind", async () => {
		renderCalendar(task);
		fireEvent.click(await screen.findByRole("button", { name: /Pond sampling/ }));

		const details = await screen.findByRole("dialog");
		expect(details).toHaveAccessibleName("Pond sampling");
		expect(screen.getByRole("button", { name: "Edit task" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Edit event" })).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Edit task" }));

		await waitFor(() => expect(screen.getByRole("dialog")).toHaveAccessibleName("Edit task"));
	});

	it("keeps the event label for an event opened from the rail", async () => {
		renderCalendar(event);
		fireEvent.click(await screen.findByRole("button", { name: /Water change/ }));

		expect(await screen.findByRole("dialog")).toHaveAccessibleName("Water change");
		expect(screen.getByRole("button", { name: "Edit event" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Edit task" })).not.toBeInTheDocument();
	});

	it("translates the task title in Hiligaynon", () => {
		localeState.locale = "hil";
		renderEditor(task);

		expect(screen.getByRole("dialog")).toHaveAccessibleName("I-edit ang task");
	});
});
