import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two Backup pages (issue #353): the last export, the scope, the sensitive
 * data warning and the history are visible to the operator who can act on them.
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
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", () => ({
	Link: ({
		href,
		children,
		...rest
	}: { href: string | { pathname?: string }; children?: ReactNode } & Record<string, unknown>) => (
		<a href={typeof href === "string" ? href : (href?.pathname ?? "#")} {...rest}>
			{children}
		</a>
	),
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
	usePathname: () => "/admin/settings/backup",
	getPathname: ({ href }: { href: string }) => href,
}));

vi.mock("@/lib/actions/step-up", () => ({ startStepUp: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mocks = vi.hoisted(() => ({
	getCurrentUser: vi.fn(),
	resolveTenantScope: vi.fn(),
	listBackupExports: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: mocks.getCurrentUser,
	assertPasswordChanged: vi.fn(async () => undefined),
}));

vi.mock("@/lib/backup/scope", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/backup/scope")>();
	return { ...actual, resolveTenantExportScope: mocks.resolveTenantScope };
});

vi.mock("@/lib/backup/audit", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/backup/audit")>();
	return { ...actual, listBackupExports: mocks.listBackupExports };
});

import AdminBackupPage from "@/app/[locale]/(admin)/admin/settings/backup/page";
import SuperadminBackupPage from "@/app/[locale]/(superadmin)/superadmin/settings/backup/page";
import { EMPTY_TENANT_SCOPE } from "@/lib/backup/scope";

const SCOPE = {
	kind: "tenant" as const,
	orgIds: ["org-1"],
	orgNames: ["CICT Farm"],
	memberUserIds: ["user-1"],
	farmIds: ["farm-1"],
	pondIds: ["pond-1"],
	membershipIds: ["membership-1"],
};

const RECORD = {
	id: "audit-1",
	createdAt: new Date("2026-10-31T07:30:00.000Z"),
	actorUserId: "user-1",
	actorLabel: "Owner One",
	actorFarmId: "cict",
	orgId: "org-1",
	scope: "tenant" as const,
	format: "sql" as const,
	outcome: "succeeded" as const,
	filename: "pakaonai-backup-tenant-20261031-0730.sql",
	bytes: 2048,
	sha256: "a".repeat(64),
	totalRows: 42,
	tables: { Pond: 3, User: 2 },
	orgIds: ["org-1"],
	orgNames: ["CICT Farm"],
	error: null,
	reason: "Monthly backup",
	stepUpAt: null,
};

const PLATFORM_RECORD = {
	...RECORD,
	id: "audit-2",
	scope: "platform" as const,
	actorLabel: "Platform Admin",
	filename: "pakaonai-backup-platform-20261031-0800.sql",
	orgIds: [],
	orgNames: [],
};

async function adminHtml(): Promise<string> {
	const page = await AdminBackupPage();
	return renderToStaticMarkup(page as React.ReactElement);
}

async function platformHtml(): Promise<string> {
	const page = await SuperadminBackupPage();
	return renderToStaticMarkup(page as React.ReactElement);
}

beforeEach(() => {
	mocks.getCurrentUser.mockReset().mockResolvedValue({ id: "user-1", displayName: "Owner One" });
	mocks.resolveTenantScope.mockReset().mockResolvedValue(SCOPE);
	mocks.listBackupExports.mockReset().mockResolvedValue([RECORD]);
});

describe("tenant Backup page", () => {
	it("shows the scope, the export control and the sensitive-data warning", async () => {
		const html = await adminHtml();

		expect(html).toContain("CICT Farm");
		expect(html).toContain("Download SQL export");
		expect(html).toContain("Handle this file as sensitive data");
		expect(html).toContain('href="/admin/settings"');
		expect(html).toContain("restore-check.mjs");
	});

	it("shows the last export with its checksum and outcome", async () => {
		const html = await adminHtml();

		expect(html).toContain("pakaonai-backup-tenant-20261031-0730.sql");
		expect(html).toContain("a".repeat(64));
		expect(html).toContain("Completed");
		expect(html).toContain("42");
	});

	it("shows an empty last-export message and an empty history", async () => {
		mocks.listBackupExports.mockResolvedValue([]);
		const html = await adminHtml();

		expect(html).toContain("No export has been run yet.");
		expect(html).toContain("No export has been recorded yet.");
	});

	it("explains that a caller without an organization cannot export", async () => {
		mocks.resolveTenantScope.mockResolvedValue(EMPTY_TENANT_SCOPE);
		const html = await adminHtml();

		expect(html).toContain("active organization");
		expect(html).not.toContain("Download SQL export");
		expect(mocks.listBackupExports).not.toHaveBeenCalled();
	});

	it("asks only for the caller's organizations' history", async () => {
		await adminHtml();
		expect(mocks.listBackupExports).toHaveBeenCalledWith({
			orgIds: ["org-1"],
			actorUserId: "user-1",
		});
	});
});

describe("platform Backup page", () => {
	it("shows the full-database scope, the reason field and the step-up export control", async () => {
		mocks.listBackupExports.mockResolvedValue([PLATFORM_RECORD, RECORD]);
		const html = await platformHtml();

		expect(html).toContain("Full database (every organization)");
		expect(html).toContain("Download full database export");
		expect(html).toContain("Reason");
		expect(html).toContain("Handle this file as sensitive data");
		expect(html).toContain('href="/superadmin/settings"');
	});

	it("lists tenant and platform exports together", async () => {
		mocks.listBackupExports.mockResolvedValue([PLATFORM_RECORD, RECORD]);
		const html = await platformHtml();

		expect(html).toContain("pakaonai-backup-platform-20261031-0800.sql");
		expect(html).toContain("pakaonai-backup-tenant-20261031-0730.sql");
		expect(html).toContain("CICT Farm");
		expect(html).toContain("Platform Admin");
	});

	it("reads the whole export history", async () => {
		await platformHtml();
		expect(mocks.listBackupExports).toHaveBeenCalledWith({
			orgIds: null,
			actorUserId: "user-1",
		});
	});
});
