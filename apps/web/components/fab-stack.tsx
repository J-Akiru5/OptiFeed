"use client";

import { cn } from "@/lib/utils";
import { HelpCircle } from "lucide-react";
import { ChatToggleButton } from "./chat/chat-toggle-button";
import { useChatWidget } from "./chat/chat-widget-provider";
import { useOnboarding } from "./onboarding-provider";

// Bottom-right floating cluster: help (top) + chat assistant (bottom),
// positioned by the --ofd-fab-* tokens in globals.css. On desktop it slides
// left of the open chat panel so nothing overlaps; on mobile it hides while
// the chat sheet is open (the sheet has its own close controls).
export function FabStack() {
	const { isOpen } = useChatWidget();
	const { startTour } = useOnboarding();

	return (
		<div
			className={cn(
				"fixed bottom-[var(--ofd-fab-anchor)] right-[var(--ofd-fab-inset)] z-40 flex flex-col items-center gap-[var(--ofd-fab-gap)] transition-[right] duration-300",
				isOpen && "max-md:hidden md:right-[calc(var(--ofd-chat-panel-w)_+_var(--ofd-fab-inset))]",
			)}
		>
			<button
				type="button"
				onClick={startTour}
				aria-label="Start onboarding tour"
				className="flex h-[var(--ofd-fab-size)] w-[var(--ofd-fab-size)] items-center justify-center rounded-full bg-[#0A3D62] text-white shadow-lg transition-colors hover:bg-[#12588c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] focus-visible:ring-offset-2"
			>
				<HelpCircle className="h-5 w-5" />
			</button>
			<ChatToggleButton />
		</div>
	);
}
