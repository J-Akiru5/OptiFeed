"use client";

import { X } from "lucide-react";
import { Mascot } from "../assistant/mascot";
import { chatToggleButton } from "./chat-theme";
import { useChatWidget } from "./chat-widget-provider";

// Chat assistant toggle. Positioned and stacked by the FabStack
// (see ../fab-stack.tsx); here it only renders the button itself.
//
// #287 closed state shows Pakoy's head instead of a generic message-square
// glyph: the floating control should look like the assistant it opens. The
// close (X) state is unchanged. Mascot is decorative by default (alt="",
// aria-hidden), so the button keeps its own accessible name.
export function ChatToggleButton() {
	const { isOpen, toggle } = useChatWidget();

	return (
		<button
			type="button"
			aria-label={isOpen ? "Close chat" : "Open chat"}
			onClick={toggle}
			className={chatToggleButton}
		>
			{isOpen ? <X size={24} /> : <Mascot pose="head" size={38} className="ring-1 ring-white/80" />}
		</button>
	);
}
