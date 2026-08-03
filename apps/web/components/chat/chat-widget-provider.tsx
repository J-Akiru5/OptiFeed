"use client";

import { useLocale, useTranslations } from "next-intl";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { type ChatMessage, loadChatHistory, saveChatHistory } from "./chat-storage";

interface ChatWidgetContextValue {
	isOpen: boolean;
	open: () => void;
	close: () => void;
	toggle: () => void;
	messages: ChatMessage[];
	isStreaming: boolean;
	send: (content: string) => void;
}

const ChatWidgetContext = createContext<ChatWidgetContextValue | null>(null);

export function ChatWidgetProvider({ children }: { children: ReactNode }) {
	const t = useTranslations("chat");
	const locale = useLocale();

	const [isOpen, setIsOpen] = useState(false);
	const [isStreaming, setIsStreaming] = useState(false);
	const [messages, setMessages] = useState<ChatMessage[]>([
		{ role: "assistant", content: t("intro") },
	]);
	const abortRef = useRef<AbortController | null>(null);

	// Hydrate persisted history once on mount (avoids SSR/hydration mismatch —
	// the server always seeds with the intro message).
	useEffect(() => {
		const stored = loadChatHistory();
		if (stored.length > 0) {
			setMessages(stored);
		}
	}, []);

	// Persist to sessionStorage on every change. Cleared only on logout.
	useEffect(() => {
		if (messages.length > 0) {
			saveChatHistory(messages);
		}
	}, [messages]);

	// Abort any in-flight stream when the widget unmounts (e.g. logout).
	useEffect(
		() => () => {
			abortRef.current?.abort();
		},
		[],
	);

	const open = useCallback(() => setIsOpen(true), []);
	const close = useCallback(() => setIsOpen(false), []);
	const toggle = useCallback(() => setIsOpen((v) => !v), []);

	const send = useCallback(
		async (content: string) => {
			const trimmed = content.trim();
			if (!trimmed || isStreaming) return;

			const history: ChatMessage[] = [
				...messages,
				{ role: "user", content: trimmed },
				{ role: "assistant", content: "" },
			];
			setMessages(history);
			setIsStreaming(true);

			const controller = new AbortController();
			abortRef.current = controller;

			try {
				const response = await fetch("/api/chat", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						locale,
						history: history.filter((m) => m.role === "user" || m.content.length > 0),
					}),
					signal: controller.signal,
				});

				if (!response.ok || !response.body) {
					throw new Error(`HTTP ${response.status}`);
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				let reply = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) {
						if (!line.startsWith("data: ")) continue;
						const payload = line.slice(6).trim();
						if (!payload) continue;
						try {
							const parsed = JSON.parse(payload) as { text?: string };
							if (typeof parsed.text !== "string") continue;
							reply += parsed.text;
							setMessages((prev) => {
								const next = [...prev];
								if (next.length > 0) {
									next[next.length - 1] = { role: "assistant", content: reply };
								}
								return next;
							});
						} catch {
							// Ignore malformed/partial SSE payloads.
						}
					}
				}

				if (!reply) {
					setMessages((prev) => [
						...prev.slice(0, -1),
						{ role: "assistant", content: t("serverError") },
					]);
				}
			} catch (error) {
				// Aborted streams (logout/unmount) are silent; network errors surface a message.
				if (!controller.signal.aborted) {
					console.error("[Chat] Stream failed:", error);
					setMessages((prev) => [...prev.slice(0, -1), { role: "assistant", content: t("error") }]);
				}
			} finally {
				abortRef.current = null;
				setIsStreaming(false);
			}
		},
		[isStreaming, locale, messages, t],
	);

	const value = useMemo<ChatWidgetContextValue>(
		() => ({ isOpen, open, close, toggle, messages, isStreaming, send }),
		[isOpen, open, close, toggle, messages, isStreaming, send],
	);

	return <ChatWidgetContext.Provider value={value}>{children}</ChatWidgetContext.Provider>;
}

export function useChatWidget(): ChatWidgetContextValue {
	const ctx = useContext(ChatWidgetContext);
	if (!ctx) {
		throw new Error("useChatWidget must be used within a ChatWidgetProvider");
	}
	return ctx;
}
