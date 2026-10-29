import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The dashboard pond switcher (issue #303).
 *
 * The list is already scoped on the server; these tests hold the interaction
 * contract: a labelled trigger, a radio menu, keyboard movement, Escape focus
 * return, the empty/single-pond states, and the quiet failure message.
 */

const pond = vi.hoisted(() => ({ switchPond: vi.fn() }));

vi.mock("@/lib/actions/pond-selection", () => ({ switchPond: pond.switchPond }));
vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
	};
});

import { PondSelector } from "@/components/pond-selector";

const PONDS = [
	{ id: "pond-1", name: "Pond One" },
	{ id: "pond-2", name: "Pond Two" },
];

function renderSelector(ponds = PONDS, activePondId = "pond-1") {
	return render(<PondSelector ponds={ponds} activePondId={activePondId} />);
}

function openMenu() {
	fireEvent.click(screen.getByRole("button", { name: "Active pond: Pond One" }));
	return screen.getAllByRole("menuitemradio");
}

beforeEach(() => {
	vi.clearAllMocks();
	pond.switchPond.mockResolvedValue(undefined);
});

describe("PondSelector control", () => {
	it("labels the trigger with the active pond and reports the popup state", () => {
		renderSelector();
		const trigger = screen.getByRole("button", { name: "Active pond: Pond One" });

		expect(trigger).toHaveAttribute("aria-haspopup", "menu");
		expect(trigger).toHaveAttribute("aria-expanded", "false");
		expect(trigger).toHaveTextContent("Pond One");
	});

	it("opens a radio menu with only the given ponds and marks the active one", async () => {
		renderSelector();
		const options = openMenu();

		expect(screen.getByRole("menu", { name: "Choose a pond" })).toBeInTheDocument();
		expect(options).toHaveLength(2);
		expect(options[0]).toHaveAttribute("aria-checked", "true");
		expect(options[1]).toHaveAttribute("aria-checked", "false");
		expect(screen.getByRole("button", { name: "Active pond: Pond One" })).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		await waitFor(() => expect(options[0]).toHaveFocus());
	});

	it("moves focus with ArrowDown/ArrowUp and Home/End", async () => {
		renderSelector();
		const options = openMenu();
		await waitFor(() => expect(options[0]).toHaveFocus());

		fireEvent.keyDown(options[0], { key: "ArrowDown" });
		expect(options[1]).toHaveFocus();

		fireEvent.keyDown(options[1], { key: "ArrowUp" });
		expect(options[0]).toHaveFocus();

		fireEvent.keyDown(options[0], { key: "End" });
		expect(options[1]).toHaveFocus();

		fireEvent.keyDown(options[1], { key: "Home" });
		expect(options[0]).toHaveFocus();
	});

	it("closes on Escape and returns focus to the trigger", async () => {
		renderSelector();
		const options = openMenu();
		await waitFor(() => expect(options[0]).toHaveFocus());

		fireEvent.keyDown(options[0], { key: "Escape" });

		expect(screen.queryByRole("menu")).toBeNull();
		expect(screen.getByRole("button", { name: "Active pond: Pond One" })).toHaveFocus();
	});

	it("switches to the chosen pond and closes", async () => {
		renderSelector();
		const options = openMenu();

		fireEvent.click(options[1]);

		await waitFor(() => expect(pond.switchPond).toHaveBeenCalledWith("pond-2"));
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
	});

	it("does not call the action when the active pond is re-selected", async () => {
		renderSelector();
		const options = openMenu();

		fireEvent.click(options[0]);

		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		expect(pond.switchPond).not.toHaveBeenCalled();
	});

	it("shows a retry message and keeps the menu open when the switch fails", async () => {
		pond.switchPond.mockRejectedValueOnce(new Error("Pond not found or access denied"));
		renderSelector();
		const options = openMenu();

		fireEvent.click(options[1]);

		expect(await screen.findByRole("alert")).toHaveTextContent("Could not switch pond. Try again.");
		expect(screen.getByRole("menu")).toBeInTheDocument();
	});
});

describe("PondSelector states", () => {
	it("shows the empty state instead of a selector when the user has no ponds", () => {
		renderSelector([], "");

		const empty = screen.getByText("No pond assigned yet");
		expect(empty).toHaveAttribute(
			"title",
			"Ask your administrator to assign a pond to your farm, then reload this page.",
		);
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.queryByRole("menu")).toBeNull();
	});

	it("shows the pond name without a menu when there is only one pond", () => {
		renderSelector([PONDS[0]], "pond-1");

		expect(screen.getByText("Pond One")).toBeInTheDocument();
		expect(screen.queryByRole("button")).toBeNull();
	});
});
