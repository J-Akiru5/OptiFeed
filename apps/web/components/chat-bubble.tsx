"use client";

import { submitChatMessage } from "@/lib/actions/chat";
import { cn } from "@/lib/utils";
import { Bot, Loader2, MessageSquare, Send, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ChatMessage {
	id: string;
	role: "user" | "bot";
	text: string;
}

export function ChatBubble() {
	const [isOpen, setIsOpen] = useState(false);
	const [input, setInput] = useState("");
	const [isPending, setIsPending] = useState(false);
	const [messages, setMessages] = useState<ChatMessage[]>([
		{
			id: "intro",
			role: "bot",
			text: "Hi! I'm your OptiFeed assistant. Ask me about your next feeding time, current FCR, missed feedings, or how to log a sample!",
		},
	]);

	const scrollRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom when new messages arrive
	// biome-ignore lint/correctness/useExhaustiveDependencies: Intentional trigger on state change
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages, isOpen]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = input.trim();
		if (!trimmed || isPending) return;

		const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", text: trimmed };
		setMessages((prev) => [...prev, userMsg]);
		setInput("");
		setIsPending(true);

		try {
			const replyText = await submitChatMessage(trimmed);
			const botMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: "bot", text: replyText };
			setMessages((prev) => [...prev, botMsg]);
		} catch (error) {
			setMessages((prev) => [
				...prev,
				{
					id: Date.now().toString(),
					role: "bot",
					text: "Oops, something went wrong. Please try again.",
				},
			]);
		} finally {
			setIsPending(false);
		}
	};

	return (
		<div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
			{/* Chat Window */}
			{isOpen && (
				<div className="mb-4 w-[350px] max-w-[calc(100vw-3rem)] rounded-2xl bg-white shadow-2xl border border-gray-100 flex flex-col overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-2 duration-200">
					{/* Header */}
					<div className="bg-[var(--ofd-base)] px-4 py-3 flex items-center justify-between text-white">
						<div className="flex items-center gap-2">
							<Bot size={20} />
							<h3 className="font-semibold text-sm">OptiFeed Assistant</h3>
						</div>
						<button
							type="button"
							onClick={() => setIsOpen(false)}
							className="text-white/80 hover:text-white transition-colors"
						>
							<X size={20} />
						</button>
					</div>

					{/* Message List */}
					<div
						ref={scrollRef}
						className="flex-1 p-4 overflow-y-auto min-h-[300px] max-h-[400px] bg-gray-50 flex flex-col gap-4"
					>
						{messages.map((m) => (
							<div
								key={m.id}
								className={cn(
									"flex gap-2 max-w-[85%]",
									m.role === "user" ? "self-end flex-row-reverse" : "self-start",
								)}
							>
								<div
									className={cn(
										"flex shrink-0 items-center justify-center h-8 w-8 rounded-full",
										m.role === "user" ? "bg-blue-100 text-blue-600" : "bg-gray-200 text-gray-600",
									)}
								>
									{m.role === "user" ? <User size={16} /> : <Bot size={16} />}
								</div>
								<div
									className={cn(
										"rounded-2xl px-4 py-2 text-sm shadow-sm whitespace-pre-wrap",
										m.role === "user"
											? "bg-blue-600 text-white rounded-tr-none"
											: "bg-white text-gray-800 rounded-tl-none border border-gray-100",
									)}
								>
									{/* Basic bold parsing for the bot responses */}
									{m.text.split(/(\*\*.*?\*\*)/g).map((part, i) => {
										const key = part + i.toString();
										if (part.startsWith("**") && part.endsWith("**")) {
											return <strong key={key}>{part.slice(2, -2)}</strong>;
										}
										return <span key={key}>{part}</span>;
									})}
								</div>
							</div>
						))}
						{isPending && (
							<div className="flex gap-2 self-start max-w-[85%]">
								<div className="flex shrink-0 items-center justify-center h-8 w-8 rounded-full bg-gray-200 text-gray-600">
									<Bot size={16} />
								</div>
								<div className="rounded-2xl px-4 py-3 bg-white border border-gray-100 rounded-tl-none flex items-center justify-center">
									<Loader2 size={16} className="animate-spin text-gray-400" />
								</div>
							</div>
						)}
					</div>

					{/* Input Form */}
					<form
						onSubmit={handleSubmit}
						className="p-3 bg-white border-t border-gray-100 flex gap-2"
					>
						<input
							type="text"
							placeholder="Ask me something..."
							value={input}
							onChange={(e) => setInput(e.target.value)}
							className="flex-1 px-4 py-2 bg-gray-100 rounded-full text-sm outline-none focus:ring-2 focus:ring-[var(--ofd-base)]/20 transition-all"
						/>
						<button
							type="submit"
							disabled={isPending || !input.trim()}
							className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--ofd-base)] text-white disabled:opacity-50 transition-opacity hover:opacity-90"
						>
							<Send size={16} className="ml-1" />
						</button>
					</form>
				</div>
			)}

			{/* Floating Toggle Button */}
			<button
				type="button"
				aria-label="Toggle Help Chat"
				onClick={() => setIsOpen(!isOpen)}
				className="flex h-[var(--ofd-touch-min)] w-[var(--ofd-touch-min)] items-center justify-center rounded-full bg-[var(--ofd-action)] text-white shadow-lg transition-transform hover:scale-110 active:scale-95"
			>
				{isOpen ? <X size={24} /> : <MessageSquare size={24} />}
			</button>
		</div>
	);
}
