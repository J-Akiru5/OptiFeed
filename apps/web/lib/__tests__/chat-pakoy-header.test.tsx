import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/components/chat/chat-widget-provider", () => ({
	useChatWidget: () => ({ isOpen: false, open: vi.fn() }),
}));

import { PakoyGreeting } from "@/components/assistant/pakoy-greeting";
import { ChatConversation } from "@/components/chat/chat-conversation";

afterEach(cleanup);

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

function conversation() {
	return (
		<ChatConversation
			messages={[
				{ role: "assistant", content: "Hi! I'm Pakoy. How can I help you today?" },
				{ role: "user", content: "When is the next feeding?" },
			]}
			isStreaming={false}
			chips={["When is the next feeding?"]}
			onSend={vi.fn()}
			onExecuteAction={vi.fn()}
			onCancelAction={vi.fn()}
			onClose={vi.fn()}
		/>
	);
}

describe("Pakoy in the chat (#221)", () => {
	it("names the panel Pakoy and shows his head instead of the bot glyph", () => {
		const { container } = render(conversation());

		expect(screen.getByRole("heading", { name: "Pakoy" })).toBeVisible();
		expect(screen.queryByText("PakaonAI Assistant")).toBeNull();

		const avatars = container.querySelectorAll('[data-pose="head"] img');
		// The header avatar plus the assistant bubble (the user keeps a person glyph).
		expect(avatars.length).toBe(2);
		expect(avatars[0]?.getAttribute("src")).toContain(
			encodeURIComponent("/mascot/pakoy-head.webp"),
		);
	});

	it("keeps the tagline under the name", () => {
		render(conversation());
		expect(screen.getByText("Your feeding schedule buddy.")).toBeVisible();
	});
});

describe("Pakoy's floating greeting", () => {
	it("greets once and remembers a dismissal", () => {
		const { unmount } = render(<PakoyGreeting />);

		expect(
			screen.getByText("Hi! I'm Pakoy. How can I help you today?", { exact: true }),
		).toBeVisible();

		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(
			screen.queryByText("Hi! I'm Pakoy. How can I help you today?", { exact: true }),
		).toBeNull();
		expect(localStorage.getItem("optifeed:pakoy-greeting-dismissed:v1")).toBe("true");

		// A dismissed greeting never nags again, even in a new session.
		unmount();
		sessionStorage.clear();
		render(<PakoyGreeting />);
		expect(
			screen.queryByText("Hi! I'm Pakoy. How can I help you today?", { exact: true }),
		).toBeNull();
	});

	it("stays quiet for the rest of the session once it has been seen", () => {
		sessionStorage.setItem("optifeed:pakoy-greeting-shown:v1", "true");
		render(<PakoyGreeting />);
		expect(
			screen.queryByText("Hi! I'm Pakoy. How can I help you today?", { exact: true }),
		).toBeNull();
	});

	it("opens the chat from the bubble", () => {
		render(<PakoyGreeting />);
		// The bubble body is the open affordance; dismiss is the only named button.
		expect(screen.getAllByRole("button").length).toBe(2);
	});
});
