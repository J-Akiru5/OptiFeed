"use client";

import { cn } from "@/lib/utils";
import { ChatConversation } from "./chat-conversation";
import { useChatWidget } from "./chat-widget-provider";

// Desktop (>=768px) side panel. Fixed to the right edge below the header; the
// dashboard content shell pushes itself left by exactly PANEL_WIDTH when open
// (see DashboardContentShell), so opening smoothly resizes the layout.
export const CHAT_PANEL_WIDTH = 380;

export function ChatPanel() {
	const { isOpen, close, messages, isStreaming, send } = useChatWidget();

	return (
		<aside
			aria-hidden={!isOpen}
			className={cn(
				"fixed right-0 top-16 bottom-0 z-40 hidden w-[380px] flex-col overflow-hidden border-l border-gray-200 shadow-2xl transition-transform duration-300 md:flex",
				isOpen ? "translate-x-0" : "pointer-events-none translate-x-full",
			)}
		>
			<ChatConversation
				messages={messages}
				isStreaming={isStreaming}
				onSend={send}
				onClose={close}
				className="h-full"
			/>
		</aside>
	);
}
