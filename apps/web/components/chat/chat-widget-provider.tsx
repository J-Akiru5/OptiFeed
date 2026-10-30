"use client";

import { usePathname, useRouter } from "@/i18n/routing";
import { acceptAssistantAction, rejectAssistantAction } from "@/lib/actions/assistant";
import { introKey, suggestionKeys } from "@/lib/assistant/role-intro";
import type { AssistantRole } from "@/lib/assistant/types";
import { looksLikeAssistantRequest } from "@/lib/chat/agent-intent";
import { requestHelpTarget, revealHelpTarget } from "@/lib/help/reveal";
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
import {
	type ChatActionState,
	type ChatMessage,
	loadChatHistory,
	saveChatHistory,
} from "./chat-storage";

interface ChatStepUpRequest {
	label: string;
	index: number;
}

interface ChatWidgetContextValue {
	isOpen: boolean;
	open: () => void;
	close: () => void;
	toggle: () => void;
	messages: ChatMessage[];
	isStreaming: boolean;
	send: (content: string) => void;
	executeAction: (index: number) => void;
	cancelAction: (index: number) => void;
	clearMessages: () => void;
	chips: string[];
	stepUp: ChatStepUpRequest | null;
	closeStepUp: () => void;
	confirmStepUp: () => void;
}

const ChatWidgetContext = createContext<ChatWidgetContextValue | null>(null);

interface AssistantActionPayload {
	kind?: string;
	actionId?: string;
	toolId?: string;
	summary?: string;
	fields?: Array<{ label: string; value: string }>;
	expiresAt?: string;
	text?: string;
	route?: string;
	target?: string | null;
}

export function ChatWidgetProvider({
	children,
	role = "farmer",
}: {
	children: ReactNode;
	/** Resolved on the server; only drives the intro and chips. Actions are gated server-side. */
	role?: AssistantRole;
}) {
	const t = useTranslations("chat");
	const locale = useLocale();
	const pathname = usePathname();
	const router = useRouter();

	const intro = useCallback(
		() => ({ role: "assistant" as const, content: t(introKey(role)) }),
		[t, role],
	);
	const chips = useMemo(() => suggestionKeys(role).map((key) => t(key)), [t, role]);

	const [isOpen, setIsOpen] = useState(false);
	const [isStreaming, setIsStreaming] = useState(false);
	const [messages, setMessages] = useState<ChatMessage[]>(() => [intro()]);
	const [stepUp, setStepUp] = useState<ChatStepUpRequest | null>(null);
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
	const clearMessages = useCallback(() => {
		abortRef.current?.abort();
		setMessages([intro()]);
	}, [intro]);

	/** Close the chat and ring the destination the assistant chose. */
	const navigateTo = useCallback(
		(route: string | undefined, target: string | null | undefined) => {
			if (!route) return;
			close();
			if (!target) {
				if (route !== pathname) router.push(route);
				return;
			}
			// Same screen: the control is already mounted, so ring it directly.
			if (route === pathname) {
				window.setTimeout(() => revealHelpTarget(target), 140);
				return;
			}
			// Another screen: remember the anchor and let the shell that arrives
			// draw the ring once the page has settled (same engine as help).
			requestHelpTarget(target, route);
			router.push(route);
		},
		[close, pathname, router],
	);

	const markAction = useCallback((index: number, patch: Partial<ChatActionState>) => {
		setMessages((prev) => {
			const next = [...prev];
			const target = next[index];
			if (!target?.action) return prev;
			next[index] = { ...target, action: { ...target.action, ...patch } };
			return next;
		});
	}, []);

	const send = useCallback(
		async (content: string) => {
			const trimmed = content.trim();
			if (!trimmed || isStreaming) return;

			const baseHistory: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
			setIsStreaming(true);

			const controller = new AbortController();
			abortRef.current = controller;
			let placeholderAdded = false;

			try {
				if (looksLikeAssistantRequest(trimmed, messages.slice(-8))) {
					const response = await fetch("/api/chat/assistant", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							message: trimmed,
							locale,
							history: messages.slice(-8),
						}),
						signal: controller.signal,
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const payload = (await response.json()) as { data?: AssistantActionPayload };
					const data = payload.data ?? {};

					if (data.kind === "action" && data.actionId && data.summary) {
						setMessages([
							...baseHistory,
							{
								role: "assistant",
								content: data.text ?? "",
								action: {
									actionId: data.actionId,
									toolId: data.toolId,
									summary: data.summary,
									fields: data.fields ?? [],
									status: "pending" as const,
									expiresAt: data.expiresAt,
								},
							},
						]);
						return;
					}
					if (data.kind === "clarify") {
						setMessages([...baseHistory, { role: "assistant", content: data.text ?? t("error") }]);
						return;
					}
					if (data.kind === "navigate") {
						setMessages([...baseHistory, { role: "assistant", content: data.text ?? "" }]);
						navigateTo(data.route, data.target);
						return;
					}
					// kind === "fallback": the normal chat answers it below.
				}

				const history: ChatMessage[] = [...baseHistory, { role: "assistant", content: "" }];
				setMessages(history);
				placeholderAdded = true;

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
						const ssePayload = line.slice(6).trim();
						if (!ssePayload) continue;
						try {
							const parsed = JSON.parse(ssePayload) as { text?: string };
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
					if (placeholderAdded) {
						setMessages((prev) => [
							...prev.slice(0, -1),
							{ role: "assistant", content: t("error") },
						]);
					} else {
						setMessages([...baseHistory, { role: "assistant", content: t("error") }]);
					}
				}
			} finally {
				abortRef.current = null;
				setIsStreaming(false);
			}
		},
		[isStreaming, locale, messages, navigateTo, t],
	);

	/** Accept one proposal: the server re-checks everything and runs the action. */
	const runAccept = useCallback(
		async (index: number) => {
			const message = messages[index];
			const action = message?.action;
			if (!action || action.status !== "pending" || isStreaming) return;
			if (!action.actionId) {
				markAction(index, { status: "error", result: t("actionNotAvailable") });
				return;
			}

			setIsStreaming(true);
			try {
				const result = await acceptAssistantAction(action.actionId);
				if (!result.success && result.code === "step_up_required") {
					setStepUp({ label: action.summary, index });
					return;
				}
				markAction(index, {
					status: result.success ? "confirmed" : "error",
					result: result.success ? result.message : result.error,
				});
				setMessages((prev) => [
					...prev,
					{
						role: "assistant",
						content: result.success ? result.message : `${t("actionFailed")}: ${result.error}`,
					},
				]);
			} catch (error) {
				console.error("[Chat] action failed:", error);
				setMessages((prev) => [...prev, { role: "assistant", content: t("error") }]);
			} finally {
				setIsStreaming(false);
			}
		},
		[isStreaming, markAction, messages, t],
	);

	const executeAction = useCallback(
		(index: number) => {
			void runAccept(index);
		},
		[runAccept],
	);

	const cancelAction = useCallback(
		(index: number) => {
			const action = messages[index]?.action;
			if (!action || action.status !== "pending") return;
			if (!action.actionId) {
				markAction(index, { status: "cancelled" });
				return;
			}
			void rejectAssistantAction(action.actionId).then((result) => {
				markAction(index, {
					status: result.success ? "cancelled" : "error",
					result: result.success ? undefined : result.error,
				});
			});
		},
		[markAction, messages],
	);

	const closeStepUp = useCallback(() => setStepUp(null), []);
	const confirmStepUp = useCallback(() => {
		const pending = stepUp;
		setStepUp(null);
		if (pending) void runAccept(pending.index);
	}, [runAccept, stepUp]);

	const value = useMemo<ChatWidgetContextValue>(
		() => ({
			isOpen,
			open,
			close,
			toggle,
			messages,
			isStreaming,
			send,
			executeAction,
			cancelAction,
			clearMessages,
			chips,
			stepUp,
			closeStepUp,
			confirmStepUp,
		}),
		[
			isOpen,
			open,
			close,
			toggle,
			messages,
			isStreaming,
			send,
			executeAction,
			cancelAction,
			clearMessages,
			chips,
			stepUp,
			closeStepUp,
			confirmStepUp,
		],
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
