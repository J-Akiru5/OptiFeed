import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { absoluteAppUrl, sendTelegramMessage } from "@/lib/notify/telegram";

const fetchMock = vi.fn();

describe("sendTelegramMessage", () => {
	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("is a no-op when the bot token is unset (H11 not done yet)", async () => {
		vi.stubEnv("TELEGRAM_BOT_TOKEN", undefined);
		vi.stubEnv("TELEGRAM_CHAT_ID", "chat-1");

		await expect(sendTelegramMessage("hello")).resolves.toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("is a no-op when the chat id is unset", async () => {
		vi.stubEnv("TELEGRAM_BOT_TOKEN", "token-1");
		vi.stubEnv("TELEGRAM_CHAT_ID", undefined);

		await expect(sendTelegramMessage("hello")).resolves.toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("posts once and returns true on success", async () => {
		vi.stubEnv("TELEGRAM_BOT_TOKEN", "token-1");
		vi.stubEnv("TELEGRAM_CHAT_ID", "chat-1");
		fetchMock.mockResolvedValue({ ok: true });

		await expect(sendTelegramMessage("alert text")).resolves.toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/bottoken-1/sendMessage");
		expect(JSON.parse(init.body as string)).toMatchObject({
			chat_id: "chat-1",
			text: "alert text",
		});
	});

	it("retries once after a network failure, then succeeds", async () => {
		vi.stubEnv("TELEGRAM_BOT_TOKEN", "token-1");
		vi.stubEnv("TELEGRAM_CHAT_ID", "chat-1");
		fetchMock
			.mockRejectedValueOnce(new TypeError("network down"))
			.mockResolvedValueOnce({ ok: true });

		await expect(sendTelegramMessage("alert text")).resolves.toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("gives up after one retry and returns false — never throws", async () => {
		vi.stubEnv("TELEGRAM_BOT_TOKEN", "token-1");
		vi.stubEnv("TELEGRAM_CHAT_ID", "chat-1");
		fetchMock.mockRejectedValue(new Error("boom"));

		await expect(sendTelegramMessage("alert text")).resolves.toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("treats a non-2xx response as a failed attempt", async () => {
		vi.stubEnv("TELEGRAM_BOT_TOKEN", "token-1");
		vi.stubEnv("TELEGRAM_CHAT_ID", "chat-1");
		fetchMock.mockResolvedValue({ ok: false, status: 429 });

		await expect(sendTelegramMessage("alert text")).resolves.toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe("absoluteAppUrl", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("joins the base URL and strips trailing slashes", () => {
		vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://optifeed.example/");
		expect(absoluteAppUrl("/dashboard/notifications")).toBe(
			"https://optifeed.example/dashboard/notifications",
		);
	});

	it("returns null when the base URL is not configured", () => {
		vi.stubEnv("NEXT_PUBLIC_BASE_URL", undefined);
		expect(absoluteAppUrl("/dashboard/notifications")).toBeNull();
	});
});
