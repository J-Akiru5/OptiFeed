import { lookup } from "node:dns/promises";
import { openAiCompatibleProvider } from "@/lib/ai-providers/openai-compatible";
import {
	assertHostResolvesPublic,
	checkProviderBaseUrl,
	checkProviderBaseUrlResolved,
	isPrivateIpv6,
} from "@/lib/ai-providers/url-safety";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #432 follow-up: the typed hostname is not enough. A name can resolve to a
 * private address, an IPv4-mapped IPv6 literal is rewritten by `new URL`, and a
 * redirect would carry the API key to a host nobody checked.
 */

const mockLookup = vi.mocked(lookup);

beforeEach(() => {
	mockLookup.mockReset();
	mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("IPv4-mapped IPv6 literals", () => {
	it("rejects the hex form `new URL` produces for [::ffff:127.0.0.1]", () => {
		expect(checkProviderBaseUrl("https://[::ffff:127.0.0.1]/v1").ok).toBe(false);
		expect(checkProviderBaseUrl("https://[::ffff:169.254.169.254]/v1").ok).toBe(false);
		expect(checkProviderBaseUrl("https://[::ffff:10.0.0.1]/v1").ok).toBe(false);
	});

	it("allows a mapped public address and rejects a mapped private one in either spelling", () => {
		expect(isPrivateIpv6("::ffff:7f00:1")).toBe(true);
		expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true);
		expect(isPrivateIpv6("::ffff:5db8:d822")).toBe(false);
		expect(isPrivateIpv6("fec0::1")).toBe(true);
	});
});

describe("assertHostResolvesPublic", () => {
	it("accepts a name that resolves to public addresses", async () => {
		await expect(assertHostResolvesPublic("api.groq.com")).resolves.toBeUndefined();
	});

	it("refuses a public-looking name that resolves to a private address", async () => {
		mockLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as never);
		await expect(assertHostResolvesPublic("metadata.evil.example")).rejects.toThrow(/private/);
	});

	it("refuses when any one of several records is private", async () => {
		mockLookup.mockResolvedValue([
			{ address: "93.184.216.34", family: 4 },
			{ address: "10.0.0.5", family: 4 },
		] as never);
		await expect(assertHostResolvesPublic("mixed.example")).rejects.toThrow(/private/);
	});

	it("refuses a private IPv6 record", async () => {
		mockLookup.mockResolvedValue([{ address: "fd00::1", family: 6 }] as never);
		await expect(assertHostResolvesPublic("v6.example")).rejects.toThrow(/private/);
	});

	it("refuses a name that does not resolve", async () => {
		mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
		await expect(assertHostResolvesPublic("nope.example")).rejects.toThrow(/resolved/);
	});

	it("checks an IP literal without a lookup", async () => {
		await expect(assertHostResolvesPublic("127.0.0.1")).rejects.toThrow(/private/);
		await expect(assertHostResolvesPublic("[::1]")).rejects.toThrow(/private/);
		await expect(assertHostResolvesPublic("93.184.216.34")).resolves.toBeUndefined();
		expect(mockLookup).not.toHaveBeenCalled();
	});
});

describe("checkProviderBaseUrlResolved", () => {
	it("returns the normalised URL for a public host", async () => {
		await expect(checkProviderBaseUrlResolved("https://api.groq.com/openai/v1/")).resolves.toEqual({
			ok: true,
			url: "https://api.groq.com/openai/v1",
		});
	});

	it("keeps the syntax errors without resolving", async () => {
		const result = await checkProviderBaseUrlResolved("http://api.example.com");
		expect(result.ok).toBe(false);
		expect(mockLookup).not.toHaveBeenCalled();
	});

	it("rejects a host whose DNS points inside the network", async () => {
		mockLookup.mockResolvedValue([{ address: "192.168.1.20", family: 4 }] as never);
		const result = await checkProviderBaseUrlResolved("https://innocent.example/v1");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("private");
	});
});

describe("openAiCompatibleProvider fetch", () => {
	const request = {
		config: { apiKey: "sk-test", baseUrl: "https://llm.example/v1", model: "m" },
		systemPrompt: "s",
		turns: [{ role: "user", text: "hi" }],
	} as never;

	it("refuses redirects so the API key cannot follow one", async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
			Response.json({ choices: [{ message: { content: "ok" } }] }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await openAiCompatibleProvider.complete(request);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
	});

	it("does not send the key when the host now resolves to a private address", async () => {
		mockLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as never);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(openAiCompatibleProvider.complete(request)).rejects.toThrow(/private/);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
