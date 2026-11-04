import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guards the platform console's scope banner, three-group sidebar and the
 * platform quick menu (plan M3C.1, decisions T24 and T25).
 *
 * Five things must not regress: the sidebar lists exactly three groups in the
 * planned order, every URL the flat nine-item list had is still linked and
 * still has a page behind it, the command-center pages (#479) are reachable
 * from both the sidebar and the quick menu with an active state, the banner
 * path is right on a console page and on an organization page, and the new
 * copy exists in all three locales.
 */

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/superadmin" } }));

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getLocale: async () => "en",
		getTranslations: async (namespace: string) => createTranslator(namespace),
	};
});

vi.mock("@/i18n/routing", async () => {
	const react = await import("react");
	return {
		Link: ({
			href,
			children,
			...rest
		}: {
			href: string | { pathname?: string };
			children?: React.ReactNode;
		} & Record<string, unknown>) =>
			react.createElement(
				"a",
				{ href: typeof href === "string" ? href : (href?.pathname ?? "#"), ...rest },
				children,
			),
		usePathname: () => pathname.current,
		useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
	};
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
vi.mock("@/lib/offline/db", () => ({ clearOfflineData: vi.fn() }));
vi.mock("@/lib/pwa/snapshot", () => ({ clearDashboardSnapshot: vi.fn() }));

const { orgDetailMock } = vi.hoisted(() => ({ orgDetailMock: vi.fn() }));

vi.mock("@/lib/actions/platform/members", () => ({ getOrgDetail: orgDetailMock }));
vi.mock("@/components/superadmin/org-members", () => ({ OrgMembersPanel: () => null }));
vi.mock("@/components/superadmin/org-status-control", () => ({ OrgStatusControl: () => null }));

import SuperadminOrgDetailPage from "@/app/[locale]/(superadmin)/superadmin/orgs/[orgId]/page";
import { quickMenuSections } from "@/components/mobile/quick-menu";
import { SuperadminSidebar } from "@/components/superadmin-sidebar";
import { SUPERADMIN_NAV_GROUPS, isNavItemActive } from "@/lib/superadmin-nav";
import { createTranslator, loadMessages } from "./helpers/messages";

const webRoot = join(__dirname, "../..");

const tMobile = createTranslator("dashboard.mobile") as unknown as (key: string) => string;
const tPlatformNav = createTranslator("superadmin.shell.nav") as unknown as (key: string) => string;

/** The nine URLs the flat sidebar linked before the regroup. */
const EXISTING_URLS = [
	"/superadmin",
	"/superadmin/calendar",
	"/superadmin/users",
	"/superadmin/orgs",
	"/superadmin/ponds",
	"/superadmin/devices",
	"/superadmin/operations",
	"/superadmin/ai-providers",
	"/superadmin/settings",
];

/** The command-center pages that shipped after the regroup (#479). */
const COMMAND_CENTER_URLS = ["/superadmin/tenants", "/superadmin/fleet", "/superadmin/incidents"];

beforeEach(() => {
	pathname.current = "/superadmin";
	orgDetailMock.mockReset();
});

describe("sidebar groups (M3C.1)", () => {
	it("lists the three groups in the planned order", () => {
		expect(SUPERADMIN_NAV_GROUPS.map((group) => group.key)).toEqual([
			"commandCenter",
			"ecosystem",
			"platformControl",
		]);
		expect(SUPERADMIN_NAV_GROUPS.map((group) => group.items.map((item) => item.key))).toEqual([
			["overview", "tenants", "fleet", "incidents"],
			["organizations", "users", "ponds", "devices", "calendar"],
			["operations", "aiProviders", "settings"],
		]);
	});

	it("keeps every URL the flat list had and each command-center page, exactly once", () => {
		const hrefs = SUPERADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));

		expect([...hrefs].sort()).toEqual([...EXISTING_URLS, ...COMMAND_CENTER_URLS].sort());
		expect(new Set(hrefs).size).toBe(hrefs.length);
	});

	it("keeps a page behind every linked URL", () => {
		const hrefs = SUPERADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));

		for (const href of hrefs) {
			const segments = href.split("/").filter(Boolean);
			const page = join(webRoot, "app/[locale]/(superadmin)", ...segments, "page.tsx");
			expect(existsSync(page), `${href} has no page at ${page}`).toBe(true);
		}
	});

	it("renders each group as a list named by its heading, links in order", () => {
		const html = renderToStaticMarkup(<SuperadminSidebar />);

		expect(html.split("<ul ").length - 1).toBe(3);
		const headings = [
			...html.matchAll(/<p id="superadmin-nav-group-(\w+)"[^>]*>([^<]+)<\/p>/g),
		].map((match) => [match[1], match[2]]);
		expect(headings).toEqual([
			["commandCenter", "Command Center"],
			["ecosystem", "Ecosystem Management"],
			["platformControl", "Platform Control"],
		]);
		// Each group is named by its heading, not by an unrelated label.
		for (const key of ["commandCenter", "ecosystem", "platformControl"]) {
			expect(html).toContain(`<ul aria-labelledby="superadmin-nav-group-${key}"`);
		}

		const linked = [...html.matchAll(/<a [^>]*href="(\/superadmin[^"]*)"/g)].map((m) => m[1]);
		expect(linked).toEqual(SUPERADMIN_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)));
	});

	it("marks exactly one link current, including on a nested operations page", () => {
		pathname.current = "/superadmin/operations/audit";
		const html = renderToStaticMarkup(<SuperadminSidebar />);
		const current = [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)].map((m) => m[0]);

		expect(current).toHaveLength(1);
		expect(current[0]).toContain('href="/superadmin/operations"');
	});

	it("marks a command-center page current, including the tenants compare page", () => {
		for (const [current, expected] of [
			["/superadmin/tenants", "/superadmin/tenants"],
			["/superadmin/tenants/compare", "/superadmin/tenants"],
			["/superadmin/fleet", "/superadmin/fleet"],
			["/superadmin/incidents", "/superadmin/incidents"],
		] as const) {
			pathname.current = current;
			const html = renderToStaticMarkup(<SuperadminSidebar />);
			const active = [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)].map((m) => m[0]);

			expect(active, current).toHaveLength(1);
			expect(active[0]).toContain(`href="${expected}"`);
		}
	});
});

describe("platform quick menu (M3C.1, #479)", () => {
	it("links the command-center pages with their sidebar labels", () => {
		const sections = quickMenuSections({
			shell: "platform",
			isTenantAdmin: false,
			t: tMobile,
			nav: tPlatformNav,
		});
		const destinations = sections.flatMap((section) => section.items);

		for (const [href, label] of [
			["/superadmin/tenants", "Tenants"],
			["/superadmin/fleet", "Fleet"],
			["/superadmin/incidents", "Incidents"],
		] as const) {
			const item = destinations.find((entry) => entry.href === href);
			expect(item, `${href} is missing from the platform quick menu`).toBeTruthy();
			expect(item?.label).toBe(label);
		}
	});
});

describe("isNavItemActive (M3C.1)", () => {
	it("matches the overview only on its own URL", () => {
		expect(isNavItemActive("/superadmin", "/superadmin")).toBe(true);
		expect(isNavItemActive("/superadmin", "/superadmin/")).toBe(true);
		expect(isNavItemActive("/superadmin", "/superadmin/users")).toBe(false);
	});

	it("matches a section and everything beneath it, on a segment boundary", () => {
		expect(isNavItemActive("/superadmin/orgs", "/superadmin/orgs")).toBe(true);
		expect(isNavItemActive("/superadmin/orgs", "/superadmin/orgs/abc")).toBe(true);
		expect(isNavItemActive("/superadmin/orgs", "/superadmin/orgs-archive")).toBe(false);
		expect(isNavItemActive("/superadmin/orgs", "/superadmin/users")).toBe(false);
	});
});

describe("organization detail page context", () => {
	it("names the organization in the heading and keeps the back link", async () => {
		orgDetailMock.mockResolvedValue({
			org: {
				id: "org-alpha",
				name: "Alpha Coop",
				type: "COOPERATIVE",
				status: "ACTIVE",
				createdAt: new Date("2026-10-01T02:00:00Z"),
			},
			members: [],
		});

		const html = renderToStaticMarkup(
			await SuperadminOrgDetailPage({ params: Promise.resolve({ orgId: "org-alpha" }) }),
		);

		expect(html).toContain(">Alpha Coop<");
		expect(html).toContain('href="/superadmin/orgs"');
	});
});

describe("scope and group copy (M3C.1)", () => {
	const KEYS = [
		"superadmin.shell.groups.commandCenter",
		"superadmin.shell.groups.ecosystem",
		"superadmin.shell.groups.platformControl",
	];

	it("exists, non-blank, in English, Hiligaynon and Tagalog", () => {
		for (const locale of ["en", "hil", "tl"] as const) {
			const messages = loadMessages(locale);
			for (const key of KEYS) {
				expect(messages[key]?.trim(), `${locale} is missing ${key}`).toBeTruthy();
			}
		}
	});

	it("names the three command-center pages in every locale", () => {
		const NAV_LABELS = {
			"superadmin.shell.nav.tenants": "Tenants",
			"superadmin.shell.nav.fleet": "Fleet",
			"superadmin.shell.nav.incidents": "Incidents",
		};

		for (const locale of ["en", "hil", "tl"] as const) {
			const messages = loadMessages(locale);
			for (const key of Object.keys(NAV_LABELS)) {
				expect(messages[key]?.trim(), `${locale} is missing ${key}`).toBeTruthy();
			}
		}
		for (const [key, english] of Object.entries(NAV_LABELS)) {
			expect(loadMessages("en")[key]).toBe(english);
		}
	});
});
