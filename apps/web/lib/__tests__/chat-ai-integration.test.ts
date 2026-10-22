import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real route -> real lib/ai wiring. Other route tests mock
// "@/lib/ai" wholesale, so a regression in how the route calls the client
// (missing session id, wrong model, lost stream) would go unnoticed there.

vi.mock("@/lib/auth/with-auth", () => ({
	withAuth:
		(handler: (request: Request, ctx: { ownerId: string; user: unknown }) => Promise<Response>) =>
		(request: Request) =>
			handler(request, {
				ownerId: "farm-integration",
				user: { id: "u1", email: "demo-farmer-1@optifeed.test" },
			}),
}));

vi.mock("@/lib/rate-limit", () => ({
	checkApiRateLimit: vi.fn(() => ({ success: true })),
}));

vi.mock("@/lib/chat/context", () => ({ buildChatContext: vi.fn(async () => ({})) }));
vi.mock("@/lib/chat/prompt", () => ({
	buildSystemPrompt: vi.fn(() => "system prompt"),
}));
vi.mock("@/lib/chat/fallback", () => ({
	createNamespaceTranslator: vi.fn(() => (k: string) => k),
	runFallbackIntent: vi.fn(async () => "FALLBACK_REPLY"),
}));

import { POST } from "@/app/api/chat/route";

const FALLBACK = "FALLBACK_REPLY";

function chatRequest(history: { role: "user" | "assistant"; content: string }[]): NextRequest {
	return new NextRequest("http://localhost/api/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ locale: "en", history }),
	});
}

function sseResponse(): Response {
	const body = [
		'data: {"choices":[{"delta":{"reasoning_content":"secret thinking"}}]}',
		'data: {"choices":[{"delta":{"content":"Your pond needs "}}]}',
		'data: {"choices":[{"delta":{"content":"12 kg today."}}]}',
		"data: [DONE]",
		"",
	].join("\n");
	return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function stubFetch(status = 200) {
	const mock = vi.fn(
		async (_url: string, _init: RequestInit): Promise<Response> =>
			status === 200 ? sseResponse() : new Response("nope", { status, statusText: "Bad Request" }),
	);
	vi.stubGlobal("fetch", mock);
	return mock;
}

beforeEach(() => {
	vi.stubEnv("OPENCODE_GO_API_KEY", "test-key");
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("chat route -> OpenCode Go client", () => {
	it("streams the model answer and carries the session header", async () => {
		const fetchMock = stubFetch();

		const res = await POST(chatRequest([{ role: "user", content: "How much should I feed?" }]));
		const text = await res.text();

		// The model's words reached the client, not the keyword fallback.
		expect(text).toContain("Your pond needs ");
		expect(text).toContain("12 kg today.");
		expect(text).not.toContain(FALLBACK);
		// Thinking must stay server-side.
		expect(text).not.toContain("secret thinking");

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://opencode.ai/inference/go/openai/v1/chat/completions");

		const headers = init.headers as Record<string, string>;
		expect(headers["x-opencode-session"]).toMatch(/^optifeed-[0-9a-z]+$/);
		expect(headers.Authorization).toBe("Bearer test-key");

		const payload = JSON.parse(String(init.body)) as { model: string; stream: boolean };
		expect(payload.model).toBe("deepseek-v4.1-flash");
		expect(payload.stream).toBe(true);
	});

	it("reuses one session id across turns of the same conversation", async () => {
		const fetchMock = stubFetch();

		const conversation = [{ role: "user" as const, content: "How much should I feed?" }];

		await (await POST(chatRequest(conversation))).text();
		await (
			await POST(
				chatRequest([
					...conversation,
					{ role: "assistant", content: "12 kg." },
					{ role: "user", content: "And tomorrow?" },
				]),
			)
		).text();

		const first = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		const second = fetchMock.mock.calls[1][1].headers as Record<string, string>;

		expect(first["x-opencode-session"]).toBe(second["x-opencode-session"]);
	});

	it("falls back to keyword intents when OpenCode Go rejects the call", async () => {
		stubFetch(400);

		const res = await POST(chatRequest([{ role: "user", content: "How much should I feed?" }]));
		const text = await res.text();

		expect(text).toContain(FALLBACK);
	});

	it("falls back without calling the API when no key is configured", async () => {
		vi.stubEnv("OPENCODE_GO_API_KEY", "");
		const fetchMock = stubFetch();

		const res = await POST(chatRequest([{ role: "user", content: "How much should I feed?" }]));
		const text = await res.text();

		expect(text).toContain(FALLBACK);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
