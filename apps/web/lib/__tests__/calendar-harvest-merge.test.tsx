import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #248 — Calendar and Harvest are one page.
 *
 * The legacy route must redirect (locale-aware, query string preserved), the
 * farmer navigation must expose exactly one entry, and the help/assistant
 * sources must point at the merged destination. The merged page itself is
 * covered by `farmer-calendar-page.test.tsx`; the event list is covered by
 * `upcoming-events.test.ts`.
 */

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock("@/i18n/routing", () => ({
	redirect: redirectMock,
}));

vi.mock("next-intl/server", () => ({
	getLocale: async () => "hil",
}));

import HarvestRedirectPage from "@/app/[locale]/(dashboard)/dashboard/harvest/page";

const webRoot = join(__dirname, "../..");
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

describe("/dashboard/harvest redirects to the merged page", () => {
	beforeEach(() => {
		redirectMock.mockReset();
	});

	it("keeps the query string and the active locale", async () => {
		const marker = new Error("NEXT_REDIRECT");
		redirectMock.mockImplementation(() => {
			throw marker;
		});

		await expect(
			HarvestRedirectPage({
				searchParams: Promise.resolve({ pond: "all", types: "sampling,device" }),
			}),
		).rejects.toBe(marker);

		expect(redirectMock).toHaveBeenCalledWith({
			href: "/dashboard/calendar?pond=all&types=sampling%2Cdevice",
			locale: "hil",
		});
	});

	it("redirects to the bare page when there is no query string", async () => {
		const marker = new Error("NEXT_REDIRECT");
		redirectMock.mockImplementation(() => {
			throw marker;
		});

		await expect(HarvestRedirectPage({ searchParams: Promise.resolve({}) })).rejects.toBe(marker);

		expect(redirectMock).toHaveBeenCalledWith({
			href: "/dashboard/calendar",
			locale: "hil",
		});
	});
});

describe("the farmer navigation has one Calendar & Harvest entry", () => {
	it("drops the duplicate Harvest sidebar item", () => {
		const sidebar = read("components/sidebar.tsx");

		expect(sidebar).toContain('href: "/dashboard/calendar"');
		expect(sidebar).not.toContain('href: "/dashboard/harvest"');
	});

	it("drops the duplicate Harvest entry from the mobile More sheet", () => {
		const quickMenu = read("components/mobile/quick-menu.tsx");

		expect(quickMenu).toContain('href: "/dashboard/calendar"');
		expect(quickMenu).not.toContain('href: "/dashboard/harvest"');
	});

	it("points the mobile band, help centre and assistant at the merged page", () => {
		expect(read("components/mobile/use-page-title.ts")).toContain(
			'prefix: "/dashboard/calendar", key: "calendar"',
		);
		expect(read("lib/help/guides.ts")).toContain('routes: ["/dashboard/calendar"]');
	});
});
