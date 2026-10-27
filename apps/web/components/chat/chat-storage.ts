"use client";

export interface ChatActionField {
	label: string;
	value: string;
}

export type ChatActionStatus = "pending" | "confirmed" | "cancelled" | "expired" | "error";

export interface ChatActionState {
	/** The stored `AssistantAction` row Accept/Reject acts on (issue #194). */
	actionId?: string;
	toolId?: string;
	/** Legacy fields from the pre-#194 preview. Kept so old stored chats render. */
	type?: string;
	args?: Record<string, unknown>;
	summary: string;
	fields: ChatActionField[];
	status: ChatActionStatus;
	result?: string;
	/** ISO instant; the card shows "expired" once it passes. */
	expiresAt?: string;
}

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	action?: ChatActionState;
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

/** A pending card whose `expiresAt` has passed is shown as expired. */
export function isChatActionExpired(action: ChatActionState, now: number = Date.now()): boolean {
	if (!action.expiresAt) return false;
	const expiresAt = new Date(action.expiresAt).getTime();
	return Number.isFinite(expiresAt) && expiresAt <= now;
}
