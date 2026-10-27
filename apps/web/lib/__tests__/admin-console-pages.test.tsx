import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Renders the tenant admin pages that changed in T-09a.
 *
 * Focus is on what a reader sees: translated headings, the desktop table with
 * column scopes plus the mobile card list, empty states, and dates formatted
 * through `lib/date-local` rather than `toLocaleString`.
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
	usePathname: () => "/admin",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(async () => ({ id: "user-self" })),
}));

vi.mock("@/lib/auth/permissions", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/auth/permissions")>();
	return { ...actual, hasPermission: vi.fn(async () => true) };
});

vi.mock("@/lib/prisma", () => ({
	default: { energyDevice: { findMany: vi.fn(async () => []) } },
}));

vi.mock("@/lib/actions/admin", () => ({
	getUsers: vi.fn(),
	getDevices: vi.fn(),
	getPonds: vi.fn(),
	getAllFarmHierarchies: vi.fn(),
	getAdminStats: vi.fn(),
	getAuditLog: vi.fn(),
	listTenantMembers: vi.fn(),
	createPondWithFarmer: vi.fn(),
	revealDeviceToken: vi.fn(),
	setPondStatus: vi.fn(),
	getUserPermissionState: vi.fn(),
	setUserPermission: vi.fn(),
	changeMemberRole: vi.fn(),
	inviteMember: vi.fn(),
	revokeMember: vi.fn(),
}));

import AdminAuditPage from "@/app/[locale]/(admin)/admin/audit/page";
import AdminDevicesPage from "@/app/[locale]/(admin)/admin/devices/page";
import AdminHierarchyPage from "@/app/[locale]/(admin)/admin/hierarchy/page";
import AdminOverviewPage from "@/app/[locale]/(admin)/admin/page";
import AdminPondsPage from "@/app/[locale]/(admin)/admin/ponds/page";
import AdminSettingsPage from "@/app/[locale]/(admin)/admin/settings/page";
import AdminUsersPage from "@/app/[locale]/(admin)/admin/users/page";
import {
	getAdminStats,
	getAllFarmHierarchies,
	getAuditLog,
	getDevices,
	getPonds,
	getUsers,
	listTenantMembers,
} from "@/lib/actions/admin";
import { formatDateTimeLocal } from "@/lib/date-local";

const FIXTURE_DATE = new Date("2026-07-08T16:19:00");

function dateLabels(): (key: string) => string {
	const messages = JSON.parse(readFileSync(join(__dirname, "../../messages/en.json"), "utf8")) as {
		dates: Record<string, string | Record<string, string>>;
	};
	return (key: string) => {
		const [group, value] = key.split(".");
		const node = messages.dates[group];
		if (typeof node === "string") return node;
		return node?.[value] ?? value;
	};
}

const formatDate = (date: Date) => formatDateTimeLocal(date, dateLabels());

beforeEach(() => {
	vi.clearAllMocks();
});

describe("admin users page", () => {
	it("renders translated headings, scoped columns and the mobile card list", async () => {
		vi.mocked(getUsers).mockResolvedValue([
			{
				id: "user-1",
				displayName: "Juan Miguel",
				farmId: "juan-miguel",
				email: "juan@example.com",
				role: "OPERATOR",
				createdAt: FIXTURE_DATE,
				farm: { name: "Miguel Farm" },
			},
		] as unknown as Awaited<ReturnType<typeof getUsers>>);

		const html = renderToStaticMarkup(await AdminUsersPage());

		expect(html).toContain("User Management");
		expect(html).toContain("1 user in your organization");
		expect(html).toContain('scope="col"');
		expect(html).toContain("md:hidden");
		expect(html).toContain("Juan Miguel");
		expect(html).toContain("Miguel Farm");
		expect(html).toContain(formatDate(FIXTURE_DATE).fullDate);
		expect(html).not.toContain(FIXTURE_DATE.toLocaleDateString());
		expect(html).toContain('href="/admin/settings/members/user-1/permissions"');
		expect(html).not.toContain("<dialog");
	});

	it("shows the empty state with a next step instead of an empty table", async () => {
		vi.mocked(getUsers).mockResolvedValue([]);

		const html = renderToStaticMarkup(await AdminUsersPage());

		expect(html).toContain("No users in this organization yet.");
		expect(html).toContain("Register Farmer &amp; Pond");
		expect(html).not.toContain("<table");
	});
});

describe("admin devices page", () => {
	const devices = [
		{
			id: "dev-online",
			label: "Feeder 1",
			mac: "A4:CF:12:7E:3B:09",
			pondId: "pond-1",
			lastSeenAt: new Date(),
			feedLevelPercent: 42,
			gramsPerFeeding: 120,
			pond: { id: "pond-1", name: "Pond A" },
		},
		{
			id: "dev-offline",
			label: "Feeder 2",
			mac: "A4:CF:12:7E:3B:0A",
			pondId: null,
			lastSeenAt: null,
			feedLevelPercent: null,
			gramsPerFeeding: 90,
			pond: null,
		},
	];

	it("renders status, feed rate and last-seen copy in both layouts", async () => {
		vi.mocked(getDevices).mockResolvedValue(
			devices as unknown as Awaited<ReturnType<typeof getDevices>>,
		);

		const html = renderToStaticMarkup(await AdminDevicesPage());

		expect(html).toContain("Device Management");
		expect(html).toContain('scope="col"');
		expect(html).toContain("md:hidden");
		expect(html).toContain("120 g per feeding");
		expect(html).toContain("Online");
		expect(html).toContain("Offline");
		expect(html).toContain("Never");
		expect(html).toContain("Unassigned");
	});

	it("shows the empty state and hides the label-print form", async () => {
		vi.mocked(getDevices).mockResolvedValue([]);

		const html = renderToStaticMarkup(await AdminDevicesPage());

		expect(html).toContain("No devices registered yet.");
		expect(html).not.toContain('id="device-label-form"');
	});
});

describe("admin audit page", () => {
	it("shows the empty state when no events exist", async () => {
		vi.mocked(getAuditLog).mockResolvedValue([]);

		const html = renderToStaticMarkup(await AdminAuditPage());

		expect(html).toContain("Audit Log");
		expect(html).toContain("No events recorded yet.");
		expect(html).not.toContain("<table");
	});

	it("formats event times with the date helper", async () => {
		vi.mocked(getAuditLog).mockResolvedValue([
			{
				id: "evt-1",
				eventType: "feed_dispensed",
				source: "device",
				actorId: null,
				createdAt: FIXTURE_DATE,
				device: { label: "Feeder 1", mac: "A4:CF:12:7E:3B:09" },
			},
		] as unknown as Awaited<ReturnType<typeof getAuditLog>>);

		const html = renderToStaticMarkup(await AdminAuditPage());

		expect(html).toContain(formatDate(FIXTURE_DATE).full);
		expect(html).toContain("feed_dispensed");
		expect(html).toContain("—");
	});
});

describe("admin overview page", () => {
	it("renders translated stat cards and recent activity", async () => {
		vi.mocked(getAdminStats).mockResolvedValue({
			userCount: 3,
			pondCount: 2,
			deviceCount: 1,
			recentEvents: [
				{
					id: "evt-1",
					eventType: "connected",
					source: "device",
					createdAt: FIXTURE_DATE,
					device: { label: "Feeder 1" },
				},
			],
		} as unknown as Awaited<ReturnType<typeof getAdminStats>>);

		const html = renderToStaticMarkup(await AdminOverviewPage());

		expect(html).toContain("Admin Overview");
		expect(html).toContain("System-wide statistics and recent activity.");
		expect(html).toContain("Recent Activity");
		expect(html).toContain("Feeder 1");
		expect(html).toContain(formatDate(FIXTURE_DATE).full);
	});
});

describe("admin hierarchy page", () => {
	it("translates the tree badges and plural device count", async () => {
		vi.mocked(getAllFarmHierarchies).mockResolvedValue([
			{
				user: {
					id: "user-1",
					displayName: "Juan Miguel",
					email: "juan@example.com",
					farmId: "juan-miguel",
					role: "OPERATOR",
				},
				farm: { id: "farm-1", name: "Miguel Farm", ownerId: "juan-miguel" },
				ponds: [
					{
						id: "pond-1",
						name: "Pond A",
						status: "ACTIVE",
						devices: [
							{
								id: "dev-1",
								label: "Feeder 1",
								lastSeenAt: new Date().toISOString(),
							},
						],
					},
				],
			},
		] as unknown as Awaited<ReturnType<typeof getAllFarmHierarchies>>);

		const html = renderToStaticMarkup(await AdminHierarchyPage());

		expect(html).toContain("Farm Hierarchy");
		expect(html).toContain("Miguel Farm");
		expect(html).toContain("Farm ID: juan-miguel");
		expect(html).toContain("1 device");
		expect(html).toContain("Online");
		expect(html).toContain("Operator");
	});

	it("shows the empty state when the organization has no users", async () => {
		vi.mocked(getAllFarmHierarchies).mockResolvedValue([]);

		const html = renderToStaticMarkup(await AdminHierarchyPage());

		expect(html).toContain("No users found.");
	});
});

describe("admin ponds page", () => {
	it("renders the pond card with translated status and counts", async () => {
		vi.mocked(getPonds).mockResolvedValue([
			{
				id: "pond-1234567890abc",
				name: "Pond A",
				status: "ACTIVE",
				ownerId: "juan-miguel",
				feedsPerDay: 3,
				owner: { displayName: "Juan Miguel" },
				farm: { name: "Miguel Farm" },
				energyDevices: [{ id: "dev-1" }],
				_count: { biomassLogs: 4, notifications: 0, ownershipHistory: 1 },
			},
		] as unknown as Awaited<ReturnType<typeof getPonds>>);

		const html = renderToStaticMarkup(await AdminPondsPage());

		expect(html).toContain("Pond Management");
		expect(html).toContain("Pond A");
		expect(html).toContain("Active");
		expect(html).toContain("Juan Miguel");
		expect(html).toContain("Miguel Farm");
		expect(html).toContain("1 ownership event");
		expect(html).toContain("ID: pond-1234567…");
	});

	it("shows the empty state with the onboarding action", async () => {
		vi.mocked(getPonds).mockResolvedValue([]);

		const html = renderToStaticMarkup(await AdminPondsPage());

		expect(html).toContain("No ponds registered yet.");
		expect(html).toContain("Register Farmer &amp; Pond");
	});
});

describe("admin settings page", () => {
	it("renders the members table and formats the joined date", async () => {
		vi.mocked(listTenantMembers).mockResolvedValue([
			{
				membershipId: "m-1",
				userId: "user-1",
				orgId: "org-1",
				orgName: "Miguel Farm",
				displayName: "Juan Miguel",
				farmId: "juan-miguel",
				email: "juan@example.com",
				role: "OWNER",
				callerRole: "OWNER",
				permissions: [],
				joinedAt: FIXTURE_DATE,
				isSelf: true,
				isPlatformAdmin: false,
				isLastOwner: true,
			},
		] as unknown as Awaited<ReturnType<typeof listTenantMembers>>);

		const html = renderToStaticMarkup(await AdminSettingsPage());

		expect(html).toContain("System Settings");
		expect(html).toContain("Members");
		expect(html).toContain("Juan Miguel");
		expect(html).toContain(formatDate(FIXTURE_DATE).fullDate);
		expect(html).toContain('scope="col"');
		expect(html).not.toContain(FIXTURE_DATE.toLocaleDateString());
		expect(html).toContain("Default Feeding Rate");
		expect(html).toContain('href="/admin/settings/members/user-1/permissions"');
		expect(html).not.toContain("<dialog");
	});
});
