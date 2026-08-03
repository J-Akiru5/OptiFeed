"use client";

import { cn } from "@/lib/utils";
import { Bot, ChevronDown, Loader2, Send, User, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./chat-storage";
import { Markdown } from "./markdown";

interface ChatConversationProps {
	messages: ChatMessage[];
	isStreaming: boolean;
	onSend: (content: string) => void;
	onClose: () => void;
	className?: string;
}

export function ChatConversation({
	messages,
	isStreaming,
	onSend,
	onClose,
	className,
}: ChatConversationProps) {
	const t = useTranslations("chat");
	const [input, setInput] = useState("");
	const [nearBottom, setNearBottom] = useState(true);
	const scrollRef = useRef<HTMLDivElement>(null);

	const chips = [t("suggestionSchedule"), t("suggestionFcr"), t("suggestionLogSample")];
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

	return (
		<div className={cn("flex min-h-0 flex-col overflow-hidden bg-white", className)}>
			{/* Header */}
			<div className="flex items-center justify-between bg-[#0A3D62] px-4 py-3 text-white shrink-0">
				<div className="flex items-center gap-2">
					<Bot size={20} />
					<h3 className="text-sm font-semibold">{t("title")}</h3>
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
				className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-gray-50 p-4"
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
								m.role === "user" ? "bg-blue-100 text-blue-600" : "bg-gray-200 text-gray-600",
							)}
						>
							{m.role === "user" ? <User size={16} /> : <Bot size={16} />}
						</div>
						<div
							className={cn(
								"rounded-2xl px-4 py-2 text-sm shadow-sm",
								m.role === "user"
									? "rounded-tr-none bg-blue-600 text-white"
									: "rounded-tl-none border border-gray-100 bg-white text-gray-800",
							)}
						>
							{m.content ? <Markdown text={m.content} /> : "\u00A0"}
						</div>
					</div>
				))}

				{showTyping && (
					<div className="flex max-w-[85%] gap-2 self-start">
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-600">
							<Bot size={16} />
						</div>
						<div className="flex items-center justify-center rounded-2xl rounded-tl-none border border-gray-100 bg-white px-4 py-3">
							<Loader2 size={16} className="animate-spin text-gray-400" />
						</div>
					</div>
				)}
			</div>

			{/* Suggestion chips */}
			<div className="flex shrink-0 gap-2 overflow-x-auto border-t border-gray-100 bg-white px-3 pt-3 pb-1">
				{chips.map((chip) => (
					<button
						key={chip}
						type="button"
						disabled={isStreaming}
						onClick={() => {
							onSend(chip);
						}}
						className="shrink-0 rounded-full border border-[#0A3D62]/15 bg-[#F4F7F6] px-3 py-1.5 text-xs font-semibold text-[#0A3D62] transition hover:bg-[#E85A2A]/10 disabled:opacity-50"
					>
						{chip}
					</button>
				))}
			</div>

			{/* Input */}
			<form onSubmit={handleSubmit} className="flex shrink-0 gap-2 p-3">
				<input
					type="text"
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder={t("placeholder")}
					className="flex-1 rounded-full bg-gray-100 px-4 py-2 text-sm outline-none transition-all focus:ring-2 focus:ring-[#0A3D62]/20"
				/>
				<button
					type="submit"
					disabled={isStreaming || !input.trim()}
					className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0A3D62] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
					aria-label={t("placeholder")}
				>
					<Send size={16} className="ml-1" />
				</button>
			</form>
		</div>
	);
}
