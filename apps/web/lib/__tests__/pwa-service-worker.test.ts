import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function publicFile(name: string): string {
	return readFileSync(path.join(process.cwd(), "public", name), "utf8");
}

function messagesFile(name: string): Record<string, unknown> {
	const file = readFileSync(path.join(process.cwd(), "messages", name), "utf8");
	return JSON.parse(file) as Record<string, unknown>;
}

describe("service worker caching rules", () => {
	const sw = publicFile("sw.js");

	it("bumps the cache version so old static caches are purged", () => {
		expect(sw).toContain('const CACHE_NAME = "pakaonai-static-v3"');
		expect(sw).toMatch(
			/filter\(\(key\) => key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME\)/,
		);
	});

	it("never caches HTML or navigation responses", () => {
		expect(sw).toContain('request.mode === "navigate"');
		expect(sw).toContain('request.destination === "document"');
		expect(sw).not.toContain("/\\.(?:css|js");

		const navigation = sw.slice(
			sw.indexOf("async function navigationFallback"),
			sw.indexOf('self.addEventListener("fetch"'),
		);
		expect(navigation).toContain("fetch(request)");
		expect(navigation).toContain("caches.match(OFFLINE_URL)");
		expect(navigation).not.toContain("cache.put");
	});

	it("only caches explicit same-origin static destinations", () => {
		expect(sw).toContain(
			'const CACHEABLE_DESTINATIONS = new Set(["script", "style", "image", "font", "manifest"])',
		);
		expect(sw).toContain(
			'const STATIC_PREFIXES = ["/_next/static/", "/icons/", "/pakaonai-logo-kit/"]',
		);
		expect(sw).toContain("isCacheableAsset(url.pathname, request)");
	});

	it("bypasses API, auth and authorized requests", () => {
		expect(sw).toContain('if (request.method !== "GET") return;');
		expect(sw).toContain('url.pathname.startsWith("/api/")');
		expect(sw).toContain('url.pathname.startsWith("/auth/")');
		expect(sw).toContain('request.headers.has("authorization")');
	});

	it("refuses to store private, no-store or varied-by-cookie responses", () => {
		expect(sw).toContain("/no-store|private/i");
		expect(sw).toContain("/(authorization|cookie)/i");
		expect(sw).toContain('if (response.type !== "basic") return false;');
	});
});

describe("offline shell queue handling", () => {
	const offline = publicFile("offline.html");

	it("shows the pending offline sample count", () => {
		expect(offline).toContain('id="pendingSync"');
		expect(offline).toContain("renderPendingSamples");
		expect(offline).toContain("waiting to sync");
	});

	it("deduplicates the localStorage outbox fallback by item id", () => {
		expect(offline).toContain("readOutboxFallback().filter((entry) => entry.id !== item.id)");
	});

	it("never offers a queued feed command", () => {
		expect(offline).toContain("Feed commands are disabled offline");
		expect(offline).not.toContain('type: "feed"');
	});
});

describe("pwa i18n", () => {
	const en = messagesFile("en.json").pwa as Record<string, string>;
	const hil = messagesFile("hil.json").pwa as Record<string, string>;

	const required = [
		"offlineTitle",
		"offlineBody",
		"offlineControlsHint",
		"pendingTitle",
		"pendingBody",
		"waitingForConnection",
		"retrySync",
		"syncing",
		"retryBlockedOffline",
		"lastSynced",
		"syncPanelLabel",
		"syncUnknownError",
		"conflictLabel",
		"failedLabel",
		"itemError",
		"retryItem",
		"discardItem",
		"itemDiscarded",
		"feedDiscarded",
		"feedBlockedOffline",
		"clearedForNewUser",
		"dismiss",
		"updateAvailable",
		"refreshNow",
	];

	it("has every user-facing pwa string in both languages", () => {
		for (const key of required) {
			expect(en[key], `en.pwa.${key}`).toBeTruthy();
			expect(hil[key], `hil.pwa.${key}`).toBeTruthy();
		}
	});

	it("keeps the Hiligaynon pwa namespace in step with English", () => {
		expect(Object.keys(hil).sort()).toEqual(Object.keys(en).sort());
	});
});
