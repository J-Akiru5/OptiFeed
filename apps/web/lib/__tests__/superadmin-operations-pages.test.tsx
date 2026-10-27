import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	gate: vi.fn(),
	health: vi.fn(),
	firmware: vi.fn(),
	auditList: vi.fn(),
	auditOptions: vi.fn(),
	auditDetail: vi.fn(),
	storedAnnouncement: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: mocks.gate,
}));
vi.mock("@/lib/platform/health", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/platform/health")>()),
	getSystemHealth: mocks.health,
}));
vi.mock("@/lib/platform/firmware", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/platform/firmware")>()),
	getFirmwareFleet: mocks.firmware,
}));
vi.mock("@/lib/platform/audit-log", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/platform/audit-log")>()),
	listPlatformAuditEntries: mocks.auditList,
	getAuditFilterOptions: mocks.auditOptions,
	getAuditEntry: mocks.auditDetail,
}));
vi.mock("@/lib/settings/announcement", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/settings/announcement")>()),
	getActiveAnnouncement: vi.fn(),
	getStoredAnnouncement: mocks.storedAnnouncement,
}));
vi.mock("@/lib/settings/firmware-status", () => ({
	getFirmwareStatus: vi.fn(),
	OTA_WINDOW: {
		start: "10:00",
		end: "15:00",
		startMinute: 600,
		endMinute: 900,
	},
}));
vi.mock("@/components/superadmin/announcement-form", () => ({
	AnnouncementComposer: () => null,
}));
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
		Link: ({ href, children, ...rest }: { href: unknown; children?: React.ReactNode }) =>
			react.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
		getPathname: ({ href }: { href: string }) => href,
	};
});

import OperationsAnnouncementsPage from "@/app/[locale]/(superadmin)/superadmin/operations/announcements/page";
import OperationsAuditDetailPage from "@/app/[locale]/(superadmin)/superadmin/operations/audit/[id]/page";
import OperationsAuditPage from "@/app/[locale]/(superadmin)/superadmin/operations/audit/page";
import OperationsFirmwarePage from "@/app/[locale]/(superadmin)/superadmin/operations/firmware/page";
import OperationsHealthPage from "@/app/[locale]/(superadmin)/superadmin/operations/page";

const pages = [
	{
		name: "system health",
		run: () => OperationsHealthPage({ searchParams: Promise.resolve({}) }),
		loader: mocks.health,
	},
	{
		name: "firmware fleet",
		run: () => OperationsFirmwarePage(),
		loader: mocks.firmware,
	},
	{
		name: "audit log",
		run: () => OperationsAuditPage({ searchParams: Promise.resolve({}) }),
		loader: mocks.auditList,
	},
	{
		name: "audit detail",
		run: () => OperationsAuditDetailPage({ params: Promise.resolve({ id: "row-1" }) }),
		loader: mocks.auditDetail,
	},
	{
		name: "announcements",
		run: () => OperationsAnnouncementsPage(),
		loader: mocks.storedAnnouncement,
	},
];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.auditOptions.mockResolvedValue({ orgs: [], targetTypes: [], actions: [] });
});

describe("operations pages deny non-platform-admins", () => {
	it.each(pages)("$name gates before it loads data", async ({ run, loader }) => {
		mocks.gate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(run()).rejects.toThrow("NEXT_REDIRECT");

		expect(loader).not.toHaveBeenCalled();
		expect(mocks.auditOptions).not.toHaveBeenCalled();
	});

	it.each(pages)("$name only reaches its loader after the gate allows", async ({ run, loader }) => {
		mocks.gate.mockResolvedValueOnce(undefined);
		loader.mockRejectedValueOnce(new Error("loader reached"));

		await expect(run()).rejects.toThrow("loader reached");

		expect(mocks.gate).toHaveBeenCalledTimes(1);
		expect(loader).toHaveBeenCalledTimes(1);
	});
});
