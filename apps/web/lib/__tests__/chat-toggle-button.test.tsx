import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * #287 the floating chat toggle shows Pakoy's head while the chat is closed.
 *
 * The FAB used to draw a generic message-square glyph in its closed state. It
 * now renders the existing mascot head inside the same orange button, while
 * the open state keeps the close (X) control. Mascot is decorative, so the
 * button keeps its own "Open chat"/"Close chat" accessible name.
 */

const state = vi.hoisted(() => ({ isOpen: false }));

vi.mock("@/components/chat/chat-widget-provider", () => ({
	useChatWidget: () => ({ isOpen: state.isOpen, toggle: vi.fn() }),
}));

import { ChatToggleButton } from "@/components/chat/chat-toggle-button";

afterEach(() => {
	cleanup();
	state.isOpen = false;
});

describe("chat toggle button (#287)", () => {
	it("shows Pakoy's head and no close glyph while the chat is closed", () => {
		const { container } = render(<ChatToggleButton />);

		const button = screen.getByRole("button", { name: "Open chat" });
		expect(button).toBeVisible();

		const heads = button.querySelectorAll('[data-pose="head"] img');
		expect(heads).toHaveLength(1);
		expect(heads[0]?.getAttribute("src")).toContain(encodeURIComponent("/mascot/pakoy-head.webp"));

		// Mascot is decorative: it must not compete with the button's own name.
		expect(heads[0]?.getAttribute("alt")).toBe("");
		expect(heads[0]?.getAttribute("aria-hidden")).toBe("true");

		// The generic glyph and the close icon are both absent.
		expect(container.querySelector(".lucide-message-square")).toBeNull();
		expect(container.querySelector(".lucide-x")).toBeNull();
	});

	it("keeps the close glyph and drops the head while the chat is open", () => {
		state.isOpen = true;
		const { container } = render(<ChatToggleButton />);

		expect(screen.getByRole("button", { name: "Close chat" })).toBeVisible();

		expect(container.querySelector('[data-pose="head"]')).toBeNull();
		expect(container.querySelector("svg.lucide-x")).not.toBeNull();
	});
});
