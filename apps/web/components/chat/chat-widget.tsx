"use client";

import { ChatPanel } from "./chat-panel";
import { ChatSheet } from "./chat-sheet";

// Rendered inside ChatWidgetProvider (see dashboard layout). Composes the
// responsive panel (desktop) / sheet (mobile). The floating toggle lives in
// the FabStack alongside the help button (see ../fab-stack.tsx).
export function ChatWidget() {
	return (
		<>
			<ChatPanel />
			<ChatSheet />
		</>
	);
}
