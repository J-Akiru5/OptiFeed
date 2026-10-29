"use client";

import { ASSISTANT_NAME, Mascot } from "@/components/assistant/mascot";
import { cn } from "@/lib/utils";
import { ChevronDown, Loader2, Send, User, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { ChatActionCard } from "./chat-action-card";
import type { ChatMessage } from "./chat-storage";
import {
	CHAT_TOGGLE_SELECTOR,
	chatAssistantAvatar,
	chatAssistantBubble,
	chatChip,
	chatComposer,
	chatFooter,
	chatMessageList,
	chatSendButton,
	chatSurface,
	chatTypingBubble,
	chatUserAvatar,
	chatUserBubble,
} from "./chat-theme";
import { Markdown } from "./markdown";

interface ChatConversationProps {
	messages: ChatMessage[];
	isStreaming: boolean;
	chips: string[];
	onSend: (content: string) => void;
	onExecuteAction: (index: number) => void;
	onCancelAction: (index: number) => void;
	onClose: () => void;
	className?: string;
}

export function ChatConversation({
	messages,
	isStreaming,
	chips,
	onSend,
	onExecuteAction,
	onCancelAction,
	onClose,
	className,
}: ChatConversationProps) {
	const t = useTranslations("chat");
	const [input, setInput] = useState("");
	const [nearBottom, setNearBottom] = useState(true);
	const scrollRef = useRef<HTMLDivElement>(null);
	// The panel and the mobile sheet can both be mounted, so the composer needs
	// a unique id for its label. A placeholder is not a label: it disappears as
	// soon as someone types.
	const composerId = useId();

	const last = messages[messages.length - 1];
	const showTyping = isStreaming && (last?.role === "user" || last?.content === "");

	const handleScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 64);
	};

	// Auto-scroll to the newest message, but only while the user is near the
	// bottom (or just sent a message) so reading older turns mid-stream works.
	// biome-ignore lint/correctness/useExhaustiveDependencies: Intentional trigger on stream updates.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const isNewUserTurn = last?.role === "user";
		if (nearBottom || isNewUserTurn) {
			el.scrollTop = el.scrollHeight;
		}
	}, [messages, isStreaming, nearBottom]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!input.trim() || isStreaming) return;
		onSend(input);
		setInput("");
	};

	/**
	 * Escape closes the chat from anywhere inside it (the composer included) and
	 * puts focus back on the floating control that opened it. The handler stops
	 * there so an enclosing dialog does not also see the Escape.
	 */
	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key !== "Escape") return;
		event.stopPropagation();
		onClose();
		document.querySelector<HTMLElement>(CHAT_TOGGLE_SELECTOR)?.focus();
	};

	return (
		<div
			onKeyDown={handleKeyDown}
			className={cn("flex min-h-0 flex-col overflow-hidden", chatSurface, className)}
		>
			{/* Header: Pakoy's head and name replace the old bot glyph (#221). */}
			<div className="flex items-center justify-between bg-[#0A3D62] px-4 py-3 text-white shrink-0">
				<div className="flex min-w-0 items-center gap-2.5">
					<Mascot size={32} className="ring-1 ring-white/25" />
					<div className="min-w-0">
						<h3 className="truncate text-sm font-semibold leading-tight">{ASSISTANT_NAME}</h3>
						<p className="truncate text-[10px] font-medium text-white/70">{t("tagline")}</p>
					</div>
				</div>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close chat"
					className="flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
				>
					<ChevronDown size={20} className="md:hidden" />
					<X size={18} className="hidden md:block" />
				</button>
			</div>

			{/* Message list */}
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4", chatMessageList)}
			>
				{messages.map((m, i) => (
					<div
						key={`${m.role}-${i}`}
						className={cn(
							"flex max-w-[85%] gap-2",
							m.role === "user" ? "flex-row-reverse self-end" : "self-start",
						)}
					>
						<div
							className={cn(
								"flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
								m.role === "user" ? chatUserAvatar : "",
							)}
						>
							{m.role === "user" ? <User size={16} /> : <Mascot size={22} />}
						</div>
						<div
							className={cn(
								"rounded-2xl px-4 py-2 text-sm shadow-sm",
								m.role === "user"
									? cn("rounded-tr-none", chatUserBubble)
									: cn("rounded-tl-none", chatAssistantBubble),
							)}
						>
							{m.content ? <Markdown text={m.content} /> : "\u00A0"}
							{m.action && (
								<ChatActionCard
									action={m.action}
									disabled={isStreaming}
									onConfirm={() => onExecuteAction(i)}
									onCancel={() => onCancelAction(i)}
								/>
							)}
						</div>
					</div>
				))}

				{showTyping && (
					<div className="flex max-w-[85%] gap-2 self-start">
						<div
							className={cn(
								"flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
								chatAssistantAvatar,
							)}
						>
							<Mascot size={22} />
						</div>
						<div
							className={cn(
								"flex items-center justify-center rounded-2xl rounded-tl-none px-4 py-3",
								chatTypingBubble,
							)}
						>
							<Loader2 size={16} className="animate-spin text-gray-400" />
						</div>
					</div>
				)}
			</div>

			{/* Suggestion chips */}
			<div className={cn("flex shrink-0 flex-wrap gap-2 px-3 pt-3 pb-1", chatFooter)}>
				{chips.map((chip) => (
					<button
						key={chip}
						type="button"
						disabled={isStreaming}
						onClick={() => {
							onSend(chip);
						}}
						className={cn(
							"max-w-full shrink-0 whitespace-normal rounded-full px-3 py-1.5 text-left text-xs font-semibold",
							chatChip,
						)}
					>
						{chip}
					</button>
				))}
			</div>

			{/* Input */}
			<form onSubmit={handleSubmit} className="flex shrink-0 gap-2 p-3">
				<label htmlFor={composerId} className="sr-only">
					{t("placeholder")}
				</label>
				<input
					id={composerId}
					type="text"
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder={t("placeholder")}
					className={chatComposer}
				/>
				<button
					type="submit"
					disabled={isStreaming || !input.trim()}
					className={chatSendButton}
					aria-label={t("placeholder")}
				>
					<Send size={16} className="ml-1" />
				</button>
			</form>
		</div>
	);
}
