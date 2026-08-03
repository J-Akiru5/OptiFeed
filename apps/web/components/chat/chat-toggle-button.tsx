"use client";

import { MessageSquare, X } from "lucide-react";
import { useChatWidget } from "./chat-widget-provider";

// Floating action button, bottom-right. Sits above the mobile BottomNav
// (bottom-24) and at a standard position on desktop (md:bottom-6).
export function ChatToggleButton() {
	const { isOpen, toggle } = useChatWidget();

	return (
		<button
			type="button"
			aria-label={isOpen ? "Close chat" : "Open chat"}
			onClick={toggle}
			className="fixed bottom-24 right-4 z-40 flex h-[var(--ofd-touch-min)] w-[var(--ofd-touch-min)] items-center justify-center rounded-full bg-[#E85A2A] text-white shadow-lg transition-transform hover:scale-110 active:scale-95 md:bottom-6 md:right-6"
		>
			{isOpen ? <X size={24} /> : <MessageSquare size={24} />}
		</button>
	);
}
