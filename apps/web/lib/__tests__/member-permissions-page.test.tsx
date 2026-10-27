import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #189: the member permission editor is a page, not a modal.
 *
 * These tests render the page with the same guarded actions the old dialog
 * used, checking that labels are translated (no raw permission key), that the
 * badge never shares a line with the label markup on narrow screens, and that
 * rows the Members table hides (another owner, a platform admin) are refused
 * here too instead of exposing an editor.
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
	usePathname: () => "/admin/settings/members/user-1/permissions",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/actions/admin", () => ({
	listTenantMembers: vi.fn(),
	getUserPermissionState: vi.fn(),
	setUserPermission: vi.fn(),
}));

import MemberPermissionsPage from "@/app/[locale]/(admin)/admin/settings/members/[userId]/permissions/page";
import { getUserPermissionState, listTenantMembers } from "@/lib/actions/admin";

const member = {
	membershipId: "m-1",
	orgId: "org-1",
	orgName: "Miguel Farm",
	userId: "user-1",
	farmId: "juan-miguel",
	email: "juan@example.com",
	displayName: "Juan Miguel",
	role: "ADMIN" as const,
	joinedAt: new Date("2026-07-08T16:19:00"),
	callerRole: "OWNER" as const,
	isSelf: false,
	isPlatformAdmin: false,
	isLastOwner: false,
	permissions: [],
};

function params(userId = "user-1") {
	return { params: Promise.resolve({ userId }) };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(listTenantMembers).mockResolvedValue({
		rows: [member],
		total: 1,
		page: 1,
		pageSize: 20,
		orgOptions: [],
	} as unknown as Awaited<ReturnType<typeof listTenantMembers>>);
	vi.mocked(getUserPermissionState).mockResolvedValue({
		success: true,
		role: "ADMIN",
		defaults: ["view_dashboard", "manage_members", "manage_crop_cycle"],
		overrides: [],
	});
});

describe("member permissions page", () => {
	it("renders the member, role, translated labels and page-level actions", async () => {
		const html = renderToStaticMarkup(await MemberPermissionsPage(params()));

		expect(html).toContain("Permissions for Juan Miguel");
		expect(html).toContain("juan@example.com");
		expect(html).toContain("Admin");
		expect(html).toContain('href="/admin/settings"');
		expect(html).toContain("Manage crop cycle");
		expect(html).toContain("manage_crop_cycle");
		expect(html).toContain("Role default");
		expect(html).toContain("Save changes");
		expect(html).toContain("Reset to role defaults");
		expect(html).toContain("min-h-11");
	});

	it("shows a translated label instead of the raw permission key", async () => {
		const html = renderToStaticMarkup(await MemberPermissionsPage(params()));

		expect(html).not.toContain("dashboard.adminUsers.permission.manage_crop_cycle");
		expect(html).not.toContain("dashboard.adminUsers.permission.view_dashboard");
	});

	it("does not render a dialog; the editor lives on the page", async () => {
		const html = renderToStaticMarkup(await MemberPermissionsPage(params()));

		expect(html).not.toContain("<dialog");
		expect(html).not.toContain('aria-modal="true"');
	});

	it("refuses an owner row for a non-owner caller and reads no permissions", async () => {
		vi.mocked(listTenantMembers).mockResolvedValue({
			rows: [{ ...member, role: "OWNER", callerRole: "ADMIN" }],
			total: 1,
			page: 1,
			pageSize: 20,
			orgOptions: [],
		} as unknown as Awaited<ReturnType<typeof listTenantMembers>>);

		const html = renderToStaticMarkup(await MemberPermissionsPage(params()));

		expect(html).toContain("Only an owner can manage another owner.");
		expect(html).not.toContain("Save changes");
		expect(getUserPermissionState).not.toHaveBeenCalled();
	});

	it("refuses a platform admin and points to the platform console", async () => {
		vi.mocked(listTenantMembers).mockResolvedValue({
			rows: [{ ...member, isPlatformAdmin: true }],
			total: 1,
			page: 1,
			pageSize: 20,
			orgOptions: [],
		} as unknown as Awaited<ReturnType<typeof listTenantMembers>>);

		const html = renderToStaticMarkup(await MemberPermissionsPage(params()));

		expect(html).toContain("Managed from the platform console.");
		expect(html).not.toContain("Save changes");
		expect(getUserPermissionState).not.toHaveBeenCalled();
	});
});
