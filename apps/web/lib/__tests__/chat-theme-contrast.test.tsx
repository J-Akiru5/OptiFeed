import { contrastRatio } from "@/lib/calendar/event-colors";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #309 the chat must be readable in dark mode.
 *
 * The widget was built before the dashboard's dark-mode pass: every surface was
 * a light-only Tailwind class (`bg-white`, `bg-gray-50`, `bg-gray-100`) and the
 * composer had no text colour at all, so it inherited the near-white
 * `.dark` foreground and rendered invisible text on a light field.
 *
 * These checks lock the fix in three ways:
 *   1. every light surface/text utility rendered by the chat needs a `dark:`
 *      counterpart on the same element (the walker below);
 *   2. the specific root cause — an unpainted composer — cannot come back,
 *      because the input must carry an explicit text colour and dark field;
 *   3. the documented `CHAT_CONTRAST` pairs meet WCAG AA (4.5:1) for normal
 *      text in both themes.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

const chatState = vi.hoisted(() => ({
	isOpen: false,
	messages: [] as ChatMessage[],
	isStreaming: false,
	chips: [] as string[],
}));

vi.mock("@/components/chat/chat-widget-provider", () => ({
	useChatWidget: () => ({
		isOpen: chatState.isOpen,
		open: vi.fn(),
		close: vi.fn(),
		toggle: vi.fn(),
		messages: chatState.messages,
		isStreaming: chatState.isStreaming,
		send: vi.fn(),
		executeAction: vi.fn(),
		cancelAction: vi.fn(),
		chips: chatState.chips,
	}),
}));

import { PakoyGreeting } from "@/components/assistant/pakoy-greeting";
import { PakoyLowHopper } from "@/components/assistant/pakoy-low-hopper";
import { ChatActionCard } from "@/components/chat/chat-action-card";
import { ChatConversation } from "@/components/chat/chat-conversation";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatSheet } from "@/components/chat/chat-sheet";
import type { ChatActionState, ChatMessage } from "@/components/chat/chat-storage";
import { CHAT_CONTRAST } from "@/components/chat/chat-theme";
import { ChatToggleButton } from "@/components/chat/chat-toggle-button";

afterEach(() => {
	cleanup();
	chatState.isOpen = false;
	chatState.messages = [];
	chatState.isStreaming = false;
	chatState.chips = [];
});

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

/**
 * Light-only utilities the chat used to render without a dark variant. A new
 * light class must be added here (and given a `dark:` sibling) only when it is
 * genuinely a surface; brand fills that work in both themes are not listed.
 */
const LIGHT_BACKGROUNDS = new Set([
	"bg-white",
	"bg-gray-50",
	"bg-gray-100",
	"bg-gray-200",
	"bg-blue-100",
	"bg-[#F4F7F6]",
]);

/** Text colours picked for the light surfaces, each needing a dark sibling. */
const LIGHT_TEXT = new Set([
	"text-gray-800",
	"text-gray-700",
	"text-gray-600",
	"text-gray-500",
	"text-blue-600",
	"text-[#0A3D62]",
	"text-red-600",
	"text-green-700",
	"text-amber-700",
]);

function assertionFailure(element: Element, missing: string, light: string[]): string {
	const tag = element.tagName.toLowerCase();
	return `${tag} renders ${light.join(", ")} without ${missing} (class="${element.getAttribute("class")}")`;
}

/** Every light surface and text colour must have its dark counterpart. */
function expectThemeAware(container: HTMLElement) {
	for (const element of container.querySelectorAll("*")) {
		const classes = (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
		const lightBackgrounds = classes.filter((name) => LIGHT_BACKGROUNDS.has(name));
		const lightText = classes.filter((name) => LIGHT_TEXT.has(name));

		if (lightBackgrounds.length > 0) {
			expect(
				classes.some((name) => name.startsWith("dark:bg-")),
				assertionFailure(element, "a dark: background", lightBackgrounds),
			).toBe(true);
		}
		if (lightText.length > 0) {
			expect(
				classes.some((name) => name.startsWith("dark:text-")),
				assertionFailure(element, "a dark: text colour", lightText),
			).toBe(true);
		}
	}
}

const PENDING_ACTION: ChatActionState = {
	actionId: "act-1",
	summary: "Change the feeding amount to 184 g",
	fields: [{ label: "Feed amount", value: "184 g" }],
	status: "pending",
};

function conversation(messages: ChatMessage[], isStreaming = false) {
	return (
		<ChatConversation
			messages={messages}
			isStreaming={isStreaming}
			chips={["When is the next feeding?"]}
			onSend={vi.fn()}
			onExecuteAction={vi.fn()}
			onCancelAction={vi.fn()}
			onClose={vi.fn()}
		/>
	);
}

function openChatState(messages: ChatMessage[], isStreaming = false) {
	chatState.isOpen = true;
	chatState.messages = messages;
	chatState.isStreaming = isStreaming;
	chatState.chips = ["When is the next feeding?"];
}

describe("chat dark-mode coverage (#309)", () => {
	it("paints every conversation surface with a dark counterpart", () => {
		const { container } = render(
			conversation([
				{
					role: "assistant",
					content: "Hi! I'm **Pakoy**.\n- one\n- two\n1. first",
				},
				{ role: "assistant", content: "", action: PENDING_ACTION },
				{ role: "user", content: "When is the next feeding?" },
			]),
		);

		expectThemeAware(container);

		const root = container.firstElementChild as HTMLElement;
		expect(root).toHaveClass("bg-white", "dark:bg-gray-900");

		const list = container.querySelector('[class*="overflow-y-auto"]') as HTMLElement;
		expect(list).toHaveClass("bg-gray-50", "dark:bg-gray-950");

		const assistantBubble = container.querySelector('[class*="rounded-tl-none"]') as HTMLElement;
		expect(assistantBubble).toHaveClass(
			"bg-white",
			"dark:bg-gray-800",
			"text-gray-800",
			"dark:text-gray-100",
		);
	});

	it("keeps the composer readable instead of inheriting the dark foreground", () => {
		const { container } = render(conversation([{ role: "user", content: "Hello" }]));
		const input = screen.getByRole("textbox");

		// The root cause: no text colour meant `text-foreground` applied. The
		// field must own its ink and its field colour in both themes.
		expect(input).toHaveClass("bg-gray-100", "dark:bg-gray-800");
		expect(input).toHaveClass("text-[#0A3D62]", "dark:text-white");
		expect(input).toHaveClass("placeholder:text-[#3D5568]", "dark:placeholder:text-gray-400");
		expectThemeAware(container);

		const chip = screen.getByRole("button", { name: "When is the next feeding?" });
		expect(chip).toHaveClass("bg-[#F4F7F6]", "dark:bg-gray-800");
		expect(chip).toHaveClass("text-[#0A3D62]", "dark:text-[#8fc0ea]");

		const send = screen.getByRole("button", { name: "Ask me something..." });
		expect(send).toHaveClass("bg-[#0A3D62]", "dark:bg-[#1f66a0]");
	});

	it("covers the streaming placeholder and the user turn", () => {
		const { container } = render(
			conversation([{ role: "user", content: "Checking the schedule" }], true),
		);

		expectThemeAware(container);

		const bubbles = container.querySelectorAll('[class*="rounded-tl-none"]');
		const typing = bubbles[bubbles.length - 1] as HTMLElement;
		expect(typing).toHaveClass("bg-white", "dark:bg-gray-800");

		const userBubble = container.querySelector('[class*="rounded-tr-none"]') as HTMLElement;
		expect(userBubble).toHaveClass("bg-blue-600", "text-white");
	});

	it("keeps the desktop panel and the mobile sheet on the dark palette", () => {
		openChatState([{ role: "assistant", content: "Ready" }]);

		const panel = render(<ChatPanel />);
		const aside = panel.container.firstElementChild as HTMLElement;
		expect(aside).toHaveClass("border-gray-200", "dark:border-gray-700");
		expectThemeAware(panel.container);
		panel.unmount();

		const sheet = render(<ChatSheet />);
		const surface = sheet.container.firstElementChild as HTMLElement;
		expect(surface).toHaveClass("bg-white", "dark:bg-gray-900");
		expectThemeAware(sheet.container);
	});

	it("keeps the floating greeting, low-hopper reminder and toggle theme-aware", () => {
		const greeting = render(<PakoyGreeting />);
		expect(
			screen.getByText("Hi! I'm Pakoy. How can I help you today?", { exact: true }),
		).toBeVisible();
		const bubble = screen
			.getByText("Hi! I'm Pakoy. How can I help you today?", { exact: true })
			.closest("output") as HTMLElement;
		expect(bubble).toHaveClass("bg-white", "dark:bg-gray-900");
		expect(screen.getByText("Pakoy")).toHaveClass("text-[#C2410C]", "dark:text-[#ff8a5c]");
		expectThemeAware(greeting.container);
		greeting.unmount();

		const hopper = render(<PakoyLowHopper pondId="pond-1" levelPercent={12} low />);
		expectThemeAware(hopper.container);
		expect(screen.getByTestId("pakoy-low-hopper")).toHaveClass("bg-white", "dark:bg-gray-900");
		hopper.unmount();

		const toggle = render(<ChatToggleButton />);
		expectThemeAware(toggle.container);
		expect(screen.getByRole("button", { name: "Open chat" })).toHaveClass(
			"dark:focus-visible:ring-[#ff8a5c]",
			"dark:focus-visible:ring-offset-gray-950",
		);
	});

	it("keeps every action-card state readable in both themes", () => {
		const states: Array<{ status: ChatActionState["status"]; classes: string[] }> = [
			{ status: "confirmed", classes: ["text-green-700", "dark:text-green-400"] },
			{ status: "cancelled", classes: ["text-gray-500", "dark:text-gray-400"] },
			{ status: "expired", classes: ["text-amber-700", "dark:text-amber-400"] },
			{ status: "error", classes: ["text-red-600", "dark:text-red-400"] },
		];

		for (const state of states) {
			const { container, unmount } = render(
				<ChatActionCard
					action={{ ...PENDING_ACTION, status: state.status }}
					onConfirm={vi.fn()}
					onCancel={vi.fn()}
				/>,
			);

			expectThemeAware(container);
			expect(container.textContent).toContain(
				state.status === "confirmed"
					? "Done"
					: state.status === "cancelled"
						? "Cancelled"
						: state.status === "expired"
							? "This action expired"
							: "Failed",
			);

			const statusLine = container.querySelector(`[class*="${state.classes[0]}"]`) as HTMLElement;
			expect(statusLine).toHaveClass(...state.classes);
			unmount();
		}

		const pending = render(
			<ChatActionCard action={PENDING_ACTION} onConfirm={vi.fn()} onCancel={vi.fn()} />,
		);
		const accept = screen.getByRole("button", { name: "Accept" });
		// White on #E85A2A is only 3.54:1; the AA-safe dashboard orange is used.
		expect(accept).toHaveClass("bg-[#C2410C]", "text-white");
		expectThemeAware(pending.container);
	});
});

describe("chat contrast values (#309)", () => {
	it("documents message text, composer and placeholder in both themes", () => {
		const labels = CHAT_CONTRAST.map((pair) => pair.label);
		expect(labels).toEqual(
			expect.arrayContaining(["assistant message text", "composer text", "composer placeholder"]),
		);
	});

	it("meets WCAG AA (4.5:1) for every documented pair in both themes", () => {
		for (const pair of CHAT_CONTRAST) {
			for (const theme of ["light", "dark"] as const) {
				const { background, foreground } = pair[theme];
				expect(
					contrastRatio(background, foreground),
					`${pair.label} (${theme}): ${foreground} on ${background}`,
				).toBeGreaterThanOrEqual(4.5);
			}
		}
	});
});
