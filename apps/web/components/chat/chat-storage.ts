"use client";

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

export const CHAT_STORAGE_KEY = "optifeed.chat.history";

// Conversation history survives refreshes and panel toggles, but is cleared on
// logout (see clearChatHistory call sites). Open state is intentionally NOT
// persisted — the panel/sheet always starts closed.
export function loadChatHistory(): ChatMessage[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.sessionStorage.getItem(CHAT_STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(m): m is ChatMessage =>
				!!m &&
				typeof m === "object" &&
				(m as { role?: unknown }).role !== undefined &&
				typeof (m as { content?: unknown }).content === "string",
		);
	} catch {
		return [];
	}
}

export function saveChatHistory(messages: ChatMessage[]): void {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
	} catch {
		// Storage unavailable (private mode, quota) — chat still works in-memory.
	}
}

export function clearChatHistory(): void {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.removeItem(CHAT_STORAGE_KEY);
	} catch {
		// Ignore — nothing to clear.
	}
}
