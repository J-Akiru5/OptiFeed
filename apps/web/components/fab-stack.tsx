"use client";

import type { HelpRole } from "@/lib/help/types";
import { cn } from "@/lib/utils";
import { HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { PakoyGreeting } from "./assistant/pakoy-greeting";
import { ChatToggleButton } from "./chat/chat-toggle-button";
import { useChatWidget } from "./chat/chat-widget-provider";
import { HelpSheet } from "./help/help-sheet";

// Bottom-right floating cluster: help (top) + chat assistant (bottom),
// positioned by the --ofd-fab-* tokens in globals.css. On desktop it slides
// left of the open chat panel so nothing overlaps; on mobile it hides while
// the chat sheet is open (the sheet has its own close controls).
//
// The "?" opens the help sheet for this screen. The guided tour moved inside
// it ("Take the tour"), so one button teaches both ways.
export function FabStack({ audience = "farmer" }: { audience?: HelpRole }) {
	const { isOpen } = useChatWidget();
	const t = useTranslations("help");
	const [helpOpen, setHelpOpen] = useState(false);

	return (
		<>
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
				<button
					type="button"
					data-fab-help
					onClick={() => setHelpOpen(true)}
					aria-label={t("button")}
					title={t("button")}
					aria-haspopup="dialog"
					className="flex h-[var(--ofd-fab-size)] w-[var(--ofd-fab-size)] items-center justify-center rounded-full bg-[#0A3D62] text-white shadow-lg transition-colors hover:bg-[#12588c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] focus-visible:ring-offset-2"
				>
					<HelpCircle className="h-5 w-5" aria-hidden="true" />
				</button>
				<ChatToggleButton />
			</div>
			<HelpSheet open={helpOpen} onOpenChange={setHelpOpen} audience={audience} />
		</>
	);
}
