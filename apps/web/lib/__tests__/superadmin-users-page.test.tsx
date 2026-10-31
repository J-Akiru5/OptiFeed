import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock("@/lib/actions/superadmin", () => ({
	listAllUsers: listMock,
	grantPlatformAdmin: vi.fn(),
	revokePlatformAdmin: vi.fn(),
	disablePlatformUser: vi.fn(),
	enablePlatformUser: vi.fn(),
}));
vi.mock("@/lib/actions/step-up", () => ({ startStepUp: vi.fn() }));
vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getLocale: async () => "en",
		getTranslations: async (namespace: string) => createTranslator(namespace),
	};
});
vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", async () => {
	const react = await import("react");
	return {
		// A plain anchor, with object hrefs flattened so the test can assert the
		// query string the pager builds.
		Link: ({
			href,
			children,
			...rest
		}: {
			href: string | { pathname: string; query?: Record<string, string> };
			children?: React.ReactNode;
		}) => {
			const flat =
				typeof href === "string"
					? href
					: `${href.pathname}?${new URLSearchParams(href.query ?? {}).toString()}`;
			return react.createElement("a", { href: flat, ...rest }, children);
		},
		getPathname: ({ href }: { href: string }) => href,
		useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
	};
});

import SuperadminUsersPage from "@/app/[locale]/(superadmin)/superadmin/users/page";
import type { PlatformUserRow } from "@/lib/actions/superadmin";

const rows: PlatformUserRow[] = [
	{
		id: "u1",
		farmId: "juan-dela-cruz",
		email: "juan@example.com",
		contactEmail: null,
		displayName: "Juan Miguel",
		role: "ADMIN",
		createdAt: new Date("2026-10-01T02:00:00Z"),
		isPlatformAdmin: true,
		disabled: false,
		avatarUrl: null,
		orgs: [{ id: "org-a", name: "San Pablo Coop", role: "OWNER", memberCount: 4 }],
		pondCount: 2,
	},
	{
		id: "u2",
		farmId: "maria-santos",
		email: "maria@example.com",
		contactEmail: null,
		displayName: null,
		role: "VIEWER",
		createdAt: new Date("2026-10-02T02:00:00Z"),
		isPlatformAdmin: false,
		disabled: true,
		avatarUrl: null,
		orgs: [],
		pondCount: 0,
	},
];

function page(params: Record<string, string> = {}) {
	return SuperadminUsersPage({ searchParams: Promise.resolve(params) });
}

beforeEach(() => {
	listMock.mockReset();
	listMock.mockResolvedValue({ rows, total: 2, page: 1, pageSize: 50 });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("/superadmin/users layout (T-09c)", () => {
	it("renders a mobile card list and a md+ table with scoped headers", async () => {
		const html = renderToStaticMarkup(await page());

		// The cards-on-mobile switch: list for small screens, table from md up.
		expect(html).toContain("md:hidden");
		expect(html).toContain("hidden md:block");
		expect(html).toContain('md:hidden">');
		for (const column of ["User", "Role", "Organizations", "Ponds", "Access", "Actions"]) {
			expect(html).toContain(`>${column}</th>`);
		}
		expect(html.split('scope="col"').length - 1).toBe(6);
		expect(html).toContain("All platform users");
	});

	it("keeps the data from each row in both layouts", async () => {
		const html = renderToStaticMarkup(await page());
		expect(html).toContain("Juan Miguel");
		expect(html).toContain("maria-santos");
		expect(html).toContain("San Pablo Coop");
		expect(html).toContain("Platform");
		expect(html).toContain("Disabled");
	});

	it("has an empty state for a search with no match and offers to clear it", async () => {
		listMock.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 50 });
		const html = renderToStaticMarkup(await page({ q: "nobody" }));

		expect(html).toContain("No account matches “nobody”.");
		expect(html).toContain("Clear search");
		expect(html).not.toContain("md:hidden");
	});

	it("has a different empty state when the platform has no accounts", async () => {
		listMock.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 50 });
		const html = renderToStaticMarkup(await page());

		expect(html).toContain("No users registered.");
		expect(html).toContain("Create the first account with New Account");
	});

	it("pages with the current search kept in the next link", async () => {
		listMock.mockResolvedValue({ rows, total: 120, page: 2, pageSize: 50 });
		const html = renderToStaticMarkup(await page({ q: "juan", page: "2" }));

		expect(html).toContain("Showing 51–100 of 120");
		expect(html).toContain("/superadmin/users?q=juan&amp;page=3");
		expect(html).toContain("/superadmin/users?q=juan");
	});

	it("renders the numbered pager with a summary even when everything fits on one page", async () => {
		const html = renderToStaticMarkup(await page());
		expect(html).toContain('aria-label="Pagination"');
		expect(html).toContain("Showing 1–2 of 2");
		expect(html).not.toContain("page=2");
	});
});
