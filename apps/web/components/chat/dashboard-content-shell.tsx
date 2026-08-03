"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { useChatWidget } from "./chat-widget-provider";

// Client wrapper around the dashboard content row (Sidebar + main). On desktop,
// it pushes itself left by the chat panel width while the panel is open, so the
// panel does not overlap the content. Width transition matches ChatPanel.
export function DashboardContentShell({ children }: { children: ReactNode }) {
	const { isOpen } = useChatWidget();

	return (
		<div
			className={cn(
				"flex w-full flex-1 min-h-[calc(100vh-4rem)] transition-[margin-right] duration-300",
				isOpen && "md:mr-[380px]",
			)}
		>
			{children}
		</div>
	);
}
