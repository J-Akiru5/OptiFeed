import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #351 — the tenant settings page had two landmarks with the same name, three
 * different heading treatments and a two-column grid that left the third card
 * orphaned at desktop. These tests pin the structure that replaced it: one
 * labelled section per topic, an `h1` → `h2` → `h3` hierarchy with no repeated
 * heading or id, the shared 1 / 2 / 3 settings grid, and 44 px touch targets in
 * the members card.
 */

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getTranslations: async (namespace: string) => createTranslator(namespace),
		getLocale: async () => "en",
	};
});

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

vi.mock("@/i18n/routing", () => ({
	Link: ({
		href,
		children,
		...rest
	}: {
		href: string | { pathname?: string };
		children?: ReactNode;
	} & Record<string, unknown>) => (
		<a href={typeof href === "string" ? href : (href?.pathname ?? "#")} {...rest}>
			{children}
		</a>
	),
	getPathname: ({ href }: { href: string }) => href,
	usePathname: () => "/admin/settings",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/auth/org-scope", () => ({
	resolveOrgScope: vi.fn(async () => ({
		orgIds: ["org-1"],
		memberUserIds: ["user-1"],
		farmIds: ["farm-1"],
		pondIds: [],
	})),
}));

vi.mock("@/lib/auth/permissions", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/auth/permissions")>();
	return { ...actual, hasPermission: vi.fn(async () => true) };
});

vi.mock("@/lib/prisma", () => ({
	default: {
		orgSetting: { findUnique: vi.fn(async () => null) },
		platformSetting: { findUnique: vi.fn(async () => null) },
	},
}));

vi.mock("@/lib/actions/admin", () => ({
	listTenantMembers: vi.fn(async () => membersFixture),
	changeMemberRole: vi.fn(),
	inviteMember: vi.fn(),
	revokeMember: vi.fn(),
}));

vi.mock("@/lib/actions/org-settings", () => ({ updateOrgSettings: vi.fn() }));

import AdminSettingsPage from "@/app/[locale]/(admin)/admin/settings/page";
import { MembersSettings } from "@/components/admin/members-settings";
import type { TenantMemberOrgOption, TenantMemberRow } from "@/lib/actions/admin";

const memberRows: TenantMemberRow[] = [
	{
		membershipId: "m-1",
		userId: "user-1",
		orgId: "org-1",
		orgName: "Miguel Farm",
		displayName: "Juan Miguel",
		farmId: "juan-miguel",
		email: "juan@example.com",
		contactEmail: null,
		avatarUrl: null,
		role: "OWNER",
		callerRole: "OWNER",
		permissions: [],
		joinedAt: new Date("2026-07-08T16:19:00"),
		isSelf: false,
		isPlatformAdmin: false,
		isLastOwner: true,
	},
	{
		membershipId: "m-2",
		userId: "user-2",
		orgId: "org-1",
		orgName: "Miguel Farm",
		displayName: "Maria Santos",
		farmId: "maria-santos",
		email: "maria@example.com",
		contactEmail: null,
		avatarUrl: null,
		role: "OPERATOR",
		callerRole: "OWNER",
		permissions: ["manage_farms_ponds"],
		joinedAt: new Date("2026-07-09T08:00:00"),
		isSelf: true,
		isPlatformAdmin: false,
		isLastOwner: false,
	},
];

const orgOptions: TenantMemberOrgOption[] = [
	{ id: "org-1", name: "Miguel Farm", callerRole: "OWNER" },
];

const membersFixture = {
	rows: memberRows,
	total: 2,
	page: 1,
	pageSize: 20,
	orgOptions,
};

/** Parse server markup into a detached document so the DOM queries are real. */
function parseHtml(html: string): HTMLElement {
	const host = document.createElement("div");
	host.innerHTML = html;
	return host;
}

function headings(host: HTMLElement): string[] {
	return [...host.querySelectorAll("h1, h2, h3, h4, h5, h6")].map(
		(heading) => heading.textContent?.trim() ?? "",
	);
}

const MIN_TOUCH_TARGETS = "min-h-11";

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

describe("admin settings page structure", () => {
	it("renders one page title, three labelled sections and three card headings", async () => {
		const host = parseHtml(
			renderToStaticMarkup(await AdminSettingsPage({ searchParams: Promise.resolve({}) })),
		);

		expect(host.querySelectorAll("h1")).toHaveLength(1);
		expect([...host.querySelectorAll("h2")].map((heading) => heading.textContent?.trim())).toEqual([
			"General Settings",
			"Backup",
			"Members",
		]);
		expect([...host.querySelectorAll("h3")].map((heading) => heading.textContent?.trim())).toEqual([
			"Default Feeding Rate",
			"Notification Settings",
			"Device Registration",
		]);

		// Every section landmark is named by its own heading, never by a repeated
		// aria-label (the old page had two "General Settings" landmarks).
		const sections = [...host.querySelectorAll("section[aria-labelledby]")];
		expect(sections.length).toBeGreaterThanOrEqual(2);
		for (const section of sections) {
			const labelledBy = section.getAttribute("aria-labelledby") ?? "";
			const heading = labelledBy ? host.querySelector(`#${labelledBy}`) : null;
			expect(heading, `${labelledBy} does not resolve`).not.toBeNull();
		}

		// No duplicate ids and no heading text repeated at a different level.
		const ids = [...host.querySelectorAll("[id]")].map((element) => element.id);
		expect(new Set(ids).size).toBe(ids.length);
		const titles = headings(host);
		expect(new Set(titles).size).toBe(titles.length);
	});

	it("lays the three settings cards out 1 / 2 / 3 across without a two-column desktop", async () => {
		const host = parseHtml(
			renderToStaticMarkup(await AdminSettingsPage({ searchParams: Promise.resolve({}) })),
		);

		const grid = [...host.querySelectorAll<HTMLElement>("div.grid")].find(
			(candidate) =>
				candidate.className.includes("sm:grid-cols-2") &&
				candidate.className.includes("xl:grid-cols-3"),
		);
		expect(grid).toBeDefined();

		expect(grid?.className).toContain("grid-cols-1");
		expect(grid?.className).toContain("sm:grid-cols-2");
		expect(grid?.className).toContain("xl:grid-cols-3");
		expect(grid?.className).not.toContain("xl:grid-cols-2");
		expect(grid?.children).toHaveLength(3);
		for (const card of grid?.children ?? []) {
			expect(card.className).toContain("h-full");
		}
	});

	it("keeps the members section flush with the card and its pager inside it", async () => {
		const host = parseHtml(
			renderToStaticMarkup(await AdminSettingsPage({ searchParams: Promise.resolve({}) })),
		);

		const members = host.querySelector("#members");
		expect(members).not.toBeNull();
		expect(members?.textContent).toContain("2 members in this organization.");
		expect(members?.querySelector("nav[aria-label='Pagination']")).not.toBeNull();
		// The desktop table is hidden below md, like the shared AdminTable shell,
		// so the 46rem table cannot paint before the card view takes over.
		expect(members?.querySelector(".data-list-table")?.className).toContain("md:block");
		expect(members?.querySelector(".data-list-table")?.className).toContain("hidden");
	});

	it("shows the no-organization notice as a status message", async () => {
		const { resolveOrgScope } = await import("@/lib/auth/org-scope");
		vi.mocked(resolveOrgScope).mockResolvedValueOnce({
			orgIds: [],
			memberUserIds: [],
			farmIds: [],
			pondIds: [],
		});

		const host = parseHtml(
			renderToStaticMarkup(await AdminSettingsPage({ searchParams: Promise.resolve({}) })),
		);

		const notice = host.querySelector("[role='note']");
		expect(notice).not.toBeNull();
		expect(notice?.textContent).toContain("not an admin of an active organization");
	});
});

describe("admin settings controls", () => {
	it("gives every members control a 44 px minimum touch target", () => {
		const { container } = render(
			<MembersSettings
				members={membersFixture.rows}
				canManage
				orgOptions={membersFixture.orgOptions}
			/>,
		);

		const controls = [...container.querySelectorAll<HTMLElement>("button, select, a")];
		expect(controls.length).toBeGreaterThan(4);
		for (const control of controls) {
			expect(control.className, `${control.tagName} is under 44 px`).toMatch(
				new RegExp(`(^|\\s)(${MIN_TOUCH_TARGETS}|h-11|w-11)(\\s|$)`),
			);
		}
	});

	it("keeps every settings field at least 44 px tall", async () => {
		const host = parseHtml(
			renderToStaticMarkup(await AdminSettingsPage({ searchParams: Promise.resolve({}) })),
		);

		const fields = [...host.querySelectorAll<HTMLInputElement>("input, select")].filter(
			(field) => !["checkbox", "radio"].includes(field.type),
		);
		expect(fields.length).toBeGreaterThan(0);
		for (const field of fields) {
			expect(field.className, `${field.name} is under 44 px`).toMatch(
				new RegExp(`(^|\\s)(${MIN_TOUCH_TARGETS}|py-3)(\\s|$)`),
			);
		}
	});
});
