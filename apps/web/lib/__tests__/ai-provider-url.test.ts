import { chatCompletionsUrl, checkProviderBaseUrl } from "@/lib/ai-providers/url-safety";
import { describe, expect, it } from "vitest";

/**
 * Issue #432: the console-created provider base URL is fetched server-side with
 * an API key attached, so it must not be able to reach loopback, private,
 * link-local or cloud-metadata addresses.
 */

describe("provider base URL guard", () => {
	it("accepts a public https endpoint and trims trailing slashes", () => {
		const result = checkProviderBaseUrl("https://api.groq.com/openai/v1/");
		expect(result).toEqual({ ok: true, url: "https://api.groq.com/openai/v1" });
	});

	it("requires https", () => {
		const result = checkProviderBaseUrl("http://api.example.com/v1");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("https");
	});

	it("rejects loopback and private IPv4 targets", () => {
		for (const url of [
			"https://localhost/v1",
			"https://127.0.0.1/v1",
			"https://10.1.2.3/v1",
			"https://172.16.0.1/v1",
			"https://192.168.1.10/v1",
			"https://169.254.169.254/latest/meta-data",
			"https://100.64.0.1/v1",
		]) {
			expect(checkProviderBaseUrl(url).ok, url).toBe(false);
		}
	});

	it("rejects loopback, link-local and unique-local IPv6 targets", () => {
		for (const url of ["https://[::1]/v1", "https://[fe80::1]/v1", "https://[fc00::1]/v1"]) {
			expect(checkProviderBaseUrl(url).ok, url).toBe(false);
		}
	});

	it("rejects local-only suffixes", () => {
		for (const url of ["https://api.internal/v1", "https://printer.local/v1"]) {
			expect(checkProviderBaseUrl(url).ok, url).toBe(false);
		}
	});

	it("rejects credentials embedded in the URL", () => {
		expect(checkProviderBaseUrl("https://user:pass@api.example.com/v1").ok).toBe(false);
	});

	it("rejects a missing or malformed URL", () => {
		expect(checkProviderBaseUrl("").ok).toBe(false);
		expect(checkProviderBaseUrl("not a url").ok).toBe(false);
	});

	it("builds the chat-completions endpoint from the base URL", () => {
		expect(chatCompletionsUrl("https://api.example.com/v1")).toBe(
			"https://api.example.com/v1/chat/completions",
		);
		expect(chatCompletionsUrl("https://api.example.com/v1/")).toBe(
			"https://api.example.com/v1/chat/completions",
		);
	});
});
