import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Keyboard operation of the primary flows (ISO 25010 usability / W9).
 *
 * Every test drives the UI with real key presses through `user-event`, which
 * implements the browser's implicit activation rules (Enter and Space on a
 * button, Enter in a text field submitting its form, Tab moving in DOM order).
 * The assertions are about **focus and state**, not just that a handler ran:
 * a menu that opens without moving focus, or closes without returning it, fails
 * here even though its `onClick` fired.
 *
 * Covered: the pond switcher, the chat composer and Escape-to-close, the
 * calibration steppers, and the harvest modal (initial focus, Tab containment,
 * Escape, focus restore). The platform console's step-up dialog already has its
 * Escape/focus-return guard in `superadmin-dialogs.test.tsx`; this file does not
 * duplicate it.
 */

const pond = vi.hoisted(() => ({ switchPond: vi.fn() }));

vi.mock("@/lib/actions/pond-selection", () => ({ switchPond: pond.switchPond }));
vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

import { CalibrationNumberField } from "@/components/calibration/CalibrationNumberField";
import { ChatConversation } from "@/components/chat/chat-conversation";
import type { ChatMessage } from "@/components/chat/chat-storage";
import { Modal } from "@/components/harvest/modal";
import { PondSelector } from "@/components/pond-selector";

beforeEach(() => {
	vi.clearAllMocks();
	pond.switchPond.mockResolvedValue(undefined);
});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("pond switcher", () => {
	const PONDS = [
		{ id: "pond-1", name: "Pond One" },
		{ id: "pond-2", name: "Pond Two" },
	];

	it("opens from the trigger with ArrowDown, moves with arrows, and Escape returns focus", async () => {
		const user = userEvent.setup();
		render(<PondSelector ponds={PONDS} activePondId="pond-1" />);

		await user.tab();
		const trigger = screen.getByRole("button", { name: "Active pond: Pond One" });
		expect(trigger).toHaveFocus();

		// The trigger opens on ArrowDown/ArrowUp, not only on a pointer click.
		await user.keyboard("{ArrowDown}");
		const options = screen.getAllByRole("menuitemradio");
		await waitFor(() => expect(options[0]).toHaveFocus());

		await user.keyboard("{ArrowDown}");
		expect(options[1]).toHaveFocus();
		await user.keyboard("{ArrowUp}");
		expect(options[0]).toHaveFocus();
		await user.keyboard("{End}");
		expect(options[1]).toHaveFocus();

		await user.keyboard("{Escape}");
		expect(screen.queryByRole("menu")).toBeNull();
		expect(trigger).toHaveFocus();
	});

	it("opens with Enter, and Tab closes the menu into the next control", async () => {
		const user = userEvent.setup();
		render(
			<>
				<PondSelector ponds={PONDS} activePondId="pond-1" />
				<button type="button">Next control</button>
			</>,
		);

		await user.tab();
		await user.keyboard("{Enter}");
		const options = screen.getAllByRole("menuitemradio");
		await waitFor(() => expect(options[0]).toHaveFocus());

		await user.tab();
		expect(screen.queryByRole("menu")).toBeNull();
		// Tab closes the menu as the key leaves it. The focused option is removed
		// in the same keydown, so focus settles on the trigger inside the control
		// rather than being dropped on `<body>` — the next Tab reaches the
		// following control.
		expect(screen.getByRole("button", { name: "Active pond: Pond One" })).toHaveFocus();
		await user.tab();
		expect(screen.getByRole("button", { name: "Next control" })).toHaveFocus();
	});
});

describe("chat composer", () => {
	function conversation(onSend = vi.fn(), onClose = vi.fn()) {
		const messages: ChatMessage[] = [{ role: "assistant", content: "Ready when you are." }];
		return (
			<>
				<button type="button" data-chat-toggle="">
					Open chat
				</button>
				<ChatConversation
					messages={messages}
					isStreaming={false}
					chips={[]}
					onSend={onSend}
					onExecuteAction={vi.fn()}
					onCancelAction={vi.fn()}
					onClose={onClose}
				/>
			</>
		);
	}

	it("sends with Enter from the composer and keeps focus in the field", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		render(conversation(onSend));

		const composer = screen.getByRole("textbox");
		await user.click(composer);
		expect(composer).toHaveFocus();

		await user.keyboard("When is the next feeding?{Enter}");

		expect(onSend).toHaveBeenCalledWith("When is the next feeding?");
		expect(composer).toHaveValue("");
		// Focus stays put so a second question needs no re-aiming.
		expect(composer).toHaveFocus();
	});

	it("closes on Escape and returns focus to the floating toggle", async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();
		render(conversation(vi.fn(), onClose));

		await user.click(screen.getByRole("textbox"));
		await user.keyboard("{Escape}");

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("button", { name: "Open chat" })).toHaveFocus();
	});
});

describe("calibration steppers", () => {
	function FieldHarness() {
		const [value, setValue] = useState("99");
		return (
			<>
				<CalibrationNumberField
					id="hopper-full"
					label="Full distance"
					unit="cm"
					value={value}
					onValueChange={setValue}
					min={0}
					max={100}
					decimals={0}
					step={1}
				/>
				<button type="button">After</button>
			</>
		);
	}

	it("reaches both steppers by Tab and steps with Enter and Space", async () => {
		const user = userEvent.setup();
		render(<FieldHarness />);

		// Tab order inside the field: decrease, the input, increase.
		await user.tab();
		const decrease = screen.getByRole("button", { name: "Decrease Full distance" });
		expect(decrease).toHaveFocus();

		await user.tab();
		const input = screen.getByLabelText("Full distance");
		expect(input).toHaveFocus();

		await user.tab();
		const increase = screen.getByRole("button", { name: "Increase Full distance" });
		expect(increase).toHaveFocus();

		await user.keyboard("{Enter}");
		expect(input).toHaveValue(100);
		// Repeated presses must keep working, so focus cannot jump away.
		expect(increase).toHaveFocus();

		await user.keyboard(" ");
		expect(input).toHaveValue(100);
		expect(increase).toHaveFocus();

		await user.tab({ shift: true });
		expect(input).toHaveFocus();
	});
});

describe("harvest modal", () => {
	function ModalHarness() {
		const [open, setOpen] = useState(false);
		return (
			<>
				<button type="button" onClick={() => setOpen(true)}>
					Edit cycle
				</button>
				<Modal
					open={open}
					title="Edit cycle"
					description="Change the stocking details for this batch."
					onClose={() => setOpen(false)}
				>
					<label htmlFor="cycle-label">Cycle label</label>
					<input id="cycle-label" />
					<button type="button">Save plan</button>
				</Modal>
			</>
		);
	}

	it("moves focus into the dialog, contains Tab, and Escape restores the trigger", async () => {
		const user = userEvent.setup();
		render(<ModalHarness />);

		const trigger = screen.getByRole("button", { name: "Edit cycle" });
		trigger.focus();
		await user.keyboard("{Enter}");

		const dialog = await screen.findByRole("dialog");
		expect(dialog).toHaveAttribute("aria-modal", "true");
		await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

		// Tab is contained: from the last control it wraps to the first.
		const save = screen.getByRole("button", { name: "Save plan" });
		save.focus();
		await user.tab();
		expect(dialog.contains(document.activeElement)).toBe(true);
		expect(document.activeElement).not.toBe(save);

		// And backwards from the first control it wraps to the last.
		await user.tab({ shift: true });
		expect(save).toHaveFocus();

		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(trigger).toHaveFocus();
	});
});
