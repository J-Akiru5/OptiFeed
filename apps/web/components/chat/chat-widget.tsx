"use client";

import { ChatPanel } from "./chat-panel";
import { ChatSheet } from "./chat-sheet";
import { ChatStepUp } from "./chat-step-up";

// Rendered inside ChatWidgetProvider (see dashboard layout). Composes the
// responsive panel (desktop) / sheet (mobile) and the step-up dialog a
// protected assistant action may open. The floating toggle lives in the
// FabStack alongside the help button (see ../fab-stack.tsx).
export function ChatWidget() {
	return (
		<>
			<ChatPanel />
			<ChatSheet />
			<ChatStepUp />
		</>
	);
}
