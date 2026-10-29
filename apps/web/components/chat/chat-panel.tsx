"use client";

import { cn } from "@/lib/utils";
import { ChatConversation } from "./chat-conversation";
import { chatPanelBorder } from "./chat-theme";
import { useChatWidget } from "./chat-widget-provider";

// Desktop (>=768px) side panel. Fixed to the right edge below the header; the
// dashboard content shell pushes itself left by exactly PANEL_WIDTH when open
// (see DashboardContentShell), so opening smoothly resizes the layout.
export const CHAT_PANEL_WIDTH = 380;

export function ChatPanel() {
	const { isOpen, close, messages, isStreaming, send, executeAction, cancelAction, chips } =
		useChatWidget();

	return (
		<aside
			aria-hidden={!isOpen}
			// The closed panel is translated off-screen but still in the DOM, so
			// without `inert` its composer and buttons stay in the tab order —
			// keyboard users would tab into a panel they cannot see.
			inert={!isOpen}
			className={cn(
				"fixed right-0 top-16 bottom-0 z-40 hidden w-[var(--ofd-chat-panel-w)] flex-col overflow-hidden shadow-2xl transition-transform duration-300 md:flex",
				chatPanelBorder,
				isOpen ? "translate-x-0" : "pointer-events-none translate-x-full",
			)}
		>
			<ChatConversation
				messages={messages}
				isStreaming={isStreaming}
				chips={chips}
				onSend={send}
				onExecuteAction={executeAction}
				onCancelAction={cancelAction}
				onClose={close}
				className="h-full"
			/>
		</aside>
	);
}
