import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * axe-core coverage for the chat widget (ISO 25010 usability / W9).
 *
 * The surface is separated from `a11y-pages.test.tsx` because the widget owns
 * its own palette and its own DOM shape: a header, a scrolling log of rendered
 * Markdown, an action card and the composer. #309 locked the contrast; this
 * file locks the structure — a labelled composer, real list items, named
 * controls — with the same zero-serious/critical threshold.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

const chatState = vi.hoisted(() => ({
	isOpen: true,
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

import { ChatActionCard } from "@/components/chat/chat-action-card";
import { ChatConversation } from "@/components/chat/chat-conversation";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatSheet } from "@/components/chat/chat-sheet";
import type { ChatActionState, ChatMessage } from "@/components/chat/chat-storage";
import { expectNoSeriousOrCriticalViolations } from "./helpers/axe";

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

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	chatState.isOpen = true;
	chatState.isStreaming = false;
	chatState.chips = ["When is the next feeding?"];
	chatState.messages = [
		{
			role: "assistant",
			content: "Hi! I'm **Pakoy**.\n- check the hopper\n- log a sample\n1. then sync",
		},
		{ role: "assistant", content: "", action: PENDING_ACTION },
		{ role: "user", content: "When is the next feeding?" },
	];
});

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

describe("chat widget", () => {
	it("has no serious or critical violations in the conversation", async () => {
		const { container } = render(conversation(chatState.messages));

		// The composer carries an explicit label, not only a placeholder: a
		// placeholder disappears as soon as someone types and is not a name a
		// screen reader can announce (axe accepts either, so this is asserted
		// directly). The Markdown lists must be real lists (axe `list`).
		expect(container.querySelectorAll("ul > li").length).toBe(2);
		expect(container.querySelectorAll("ol > li").length).toBe(1);
		expect(container.querySelector("label[for]")?.textContent).toBeTruthy();

		await expectNoSeriousOrCriticalViolations(container);
	});

	it("has no serious or critical violations while streaming", async () => {
		const { container } = render(conversation(chatState.messages, true));

		await expectNoSeriousOrCriticalViolations(container);
	});

	it("has no serious or critical violations in the desktop panel", async () => {
		const { container } = render(<ChatPanel />);

		await expectNoSeriousOrCriticalViolations(container);
	});

	it("has no serious or critical violations in the mobile sheet", async () => {
		const { container } = render(<ChatSheet />);

		await expectNoSeriousOrCriticalViolations(container);
	});

	it("keeps the collapsed panel and sheet out of the tab order", async () => {
		// The closed surfaces stay in the DOM (they slide out), so without
		// `inert` their composer and buttons remain tabbable while `aria-hidden`
		// hides them from assistive tech. jsdom has no layout, so axe cannot
		// judge the off-screen state — the tab-order contract is asserted
		// directly here, and the axe run confirms nothing else regressed.
		chatState.isOpen = false;

		const panel = render(<ChatPanel />);
		const panelSurface = panel.container.querySelector("aside");
		expect(panelSurface).toHaveAttribute("aria-hidden", "true");
		expect(panelSurface).toHaveAttribute("inert");
		await expectNoSeriousOrCriticalViolations(panel.container);
		panel.unmount();

		const sheet = render(<ChatSheet />);
		const sheetSurface = sheet.container.firstElementChild;
		expect(sheetSurface).toHaveAttribute("aria-hidden", "true");
		expect(sheetSurface).toHaveAttribute("inert");
		await expectNoSeriousOrCriticalViolations(sheet.container);
	});

	it("has no serious or critical violations in every action-card state", async () => {
		const states: ChatActionState["status"][] = [
			"pending",
			"confirmed",
			"cancelled",
			"expired",
			"error",
		];

		for (const status of states) {
			const { container, unmount } = render(
				<ChatActionCard
					action={{ ...PENDING_ACTION, status }}
					onConfirm={vi.fn()}
					onCancel={vi.fn()}
				/>,
			);
			await expectNoSeriousOrCriticalViolations(container);
			unmount();
		}
	});
});
