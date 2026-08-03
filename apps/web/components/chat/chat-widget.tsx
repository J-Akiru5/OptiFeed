"use client";

import { ChatPanel } from "./chat-panel";
import { ChatSheet } from "./chat-sheet";
import { ChatToggleButton } from "./chat-toggle-button";

// Rendered inside ChatWidgetProvider (see dashboard layout). Composes the
// floating toggle with the responsive panel (desktop) / sheet (mobile).
export function ChatWidget() {
	return (
		<>
			<ChatToggleButton />
			<ChatPanel />
			<ChatSheet />
		</>
	);
}
