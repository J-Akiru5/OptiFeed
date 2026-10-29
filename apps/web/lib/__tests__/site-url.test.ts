import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { PRODUCTION_SITE_URL, resolveSiteUrl } from "@/lib/site-url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("resolveSiteUrl", () => {
	let warn: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warn.mockRestore();
		vi.unstubAllEnvs();
	});

	it("defaults to today's production origin so nothing changes when unset", () => {
		vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined);
		expect(PRODUCTION_SITE_URL).toBe("https://pakaonai.syntaxure.dev");
		expect(resolveSiteUrl()).toBe("https://pakaonai.syntaxure.dev");
	});

	it("treats a blank value as unset", () => {
		vi.stubEnv("NEXT_PUBLIC_SITE_URL", "   ");
		expect(resolveSiteUrl()).toBe(PRODUCTION_SITE_URL);
		expect(warn).not.toHaveBeenCalled();
	});

	it("uses the configured origin", () => {
		vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://optifeed.example.test");
		expect(resolveSiteUrl()).toBe("https://optifeed.example.test");
	});

	it("normalises paths, trailing slashes and casing of the host", () => {
		vi.stubEnv("NEXT_PUBLIC_SITE_URL", " https://OptiFeed.Example.Test/some/path/?x=1#frag ");
		expect(resolveSiteUrl()).toBe("https://optifeed.example.test");
	});

	it("keeps an explicit non-default port", () => {
		vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
		expect(resolveSiteUrl()).toBe("http://localhost:3000");
	});

	it("falls back to production and warns when the value is not an absolute URL", () => {
		vi.stubEnv("NEXT_PUBLIC_SITE_URL", "optifeed.example.test");
		expect(resolveSiteUrl()).toBe(PRODUCTION_SITE_URL);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("[site-url]"));
	});

	it("falls back to production and warns for a non-http scheme", () => {
		vi.stubEnv("NEXT_PUBLIC_SITE_URL", "ftp://optifeed.example.test");
		expect(resolveSiteUrl()).toBe(PRODUCTION_SITE_URL);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("[site-url]"));
	});
});

describe("env-driven site URL in metadata routes", () => {
	beforeEach(() => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("robots.txt points its sitemap at the configured origin", () => {
		vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://optifeed.example.test");
		expect(robots().sitemap).toBe("https://optifeed.example.test/sitemap.xml");
	});

	it("sitemap.xml uses the configured origin", () => {
		vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://optifeed.example.test");
		const urls = sitemap().map((entry) => entry.url);
		expect(urls).toContain("https://optifeed.example.test");
		expect(urls.every((url) => url.startsWith("https://optifeed.example.test"))).toBe(true);
	});

	it("keeps production as the default for both routes", () => {
		vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined);
		expect(robots().sitemap).toBe(`${PRODUCTION_SITE_URL}/sitemap.xml`);
		expect(sitemap()[0]?.url).toBe(PRODUCTION_SITE_URL);
	});
});
