"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { ChatConversation } from "./chat-conversation";
import { useChatWidget } from "./chat-widget-provider";

const SWIPE_CLOSE_THRESHOLD_PX = 80;
const MAX_SHEET_HEIGHT_RATIO = 0.8;

// Mobile (<768px) bottom sheet. Overlays the content (no push), can be closed
// by the drag handle (swipe down) or the header chevron, and repositions itself
// above the on-screen keyboard via the visualViewport API.
export function ChatSheet() {
	const { isOpen, close, messages, isStreaming, send } = useChatWidget();

	const [kbOffset, setKbOffset] = useState(0);
	const [sheetHeight, setSheetHeight] = useState(0);
	const [dragY, setDragY] = useState(0);
	const dragStartRef = useRef<{ y: number } | null>(null);

	// Keep the sheet above the on-screen keyboard when it opens/resizes.
	useEffect(() => {
		if (!isOpen) return;
		const vv = window.visualViewport;
		if (!vv) return;

		const update = () => {
			setKbOffset(Math.max(0, window.innerHeight - vv.height));
			setSheetHeight(Math.min(Math.floor(window.innerHeight * MAX_SHEET_HEIGHT_RATIO), vv.height));
		};

		update();
		vv.addEventListener("resize", update);
		vv.addEventListener("scroll", update);
		return () => {
			vv.removeEventListener("resize", update);
			vv.removeEventListener("scroll", update);
		};
	}, [isOpen]);

	const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		dragStartRef.current = { y: e.clientY };
		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		if (!dragStartRef.current) return;
		setDragY(Math.max(0, e.clientY - dragStartRef.current.y));
	};

	const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
		if (!dragStartRef.current) return;
		const dy = e.clientY - dragStartRef.current.y;
		dragStartRef.current = null;
		if (dy > SWIPE_CLOSE_THRESHOLD_PX) {
			close();
		}
		setDragY(0);
	};

	return (
		<div
			aria-hidden={!isOpen}
			className={cn(
				"fixed inset-x-0 bottom-0 z-50 flex h-[80vh] flex-col rounded-t-3xl bg-white shadow-2xl md:hidden",
				isOpen ? "translate-y-0" : "pointer-events-none translate-y-full",
			)}
			style={{
				height: sheetHeight || undefined,
				bottom: kbOffset,
				transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
				transition: dragY > 0 ? "none" : undefined,
			}}
		>
			{/* Drag handle */}
			<div
				role="presentation"
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerUp}
				className="flex shrink-0 cursor-grab items-center justify-center py-2.5 active:cursor-grabbing"
			>
				<div className="h-1.5 w-12 rounded-full bg-gray-300" />
			</div>

			<div className="flex min-h-0 flex-1 flex-col">
				<ChatConversation
					messages={messages}
					isStreaming={isStreaming}
					onSend={send}
					onClose={close}
					className="flex-1"
				/>
			</div>
		</div>
	);
}
