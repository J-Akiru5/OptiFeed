"use client";

import { cn } from "@/lib/utils";
import { PakoyGreeting } from "./assistant/pakoy-greeting";
import { ChatToggleButton } from "./chat/chat-toggle-button";
import { useChatWidget } from "./chat/chat-widget-provider";

// Bottom-right floating control: the chat assistant.
//
// #269 removed the floating "?" from this cluster. The dashboard header already
// carries the help control (`HelpButton`) on every width, so a second round "?"
// hovering over the right rail only duplicated it (it covered the Time
// Calibration card). Help now has exactly one entry point per surface.
//
// Positioned by the --ofd-fab-* tokens in globals.css. On desktop it slides
// left of the open chat panel so nothing overlaps; on mobile it hides while
// the chat sheet is open (the sheet has its own close controls).
export function FabStack() {
	const { isOpen } = useChatWidget();

	return (
		<div
			className={cn(
				"fixed bottom-[var(--ofd-fab-anchor)] right-[var(--ofd-fab-inset)] z-40 flex flex-col items-center gap-[var(--ofd-fab-gap)] transition-[right] duration-300",
				isOpen && "max-md:hidden md:right-[calc(var(--ofd-chat-panel-w)_+_var(--ofd-fab-inset))]",
			)}
		>
			{/* Pakoy's one-per-session hello sits left of the chat button (#221). */}
			<div className="absolute bottom-0 right-[calc(100%+0.5rem)]">
				<PakoyGreeting />
			</div>
			<ChatToggleButton />
		</div>
	);
}
