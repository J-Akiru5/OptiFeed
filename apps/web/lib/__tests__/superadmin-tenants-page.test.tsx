import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tenant health table (issue #479, M3C.3; #631).
 *
 * The rules cover the state and the ranking; this covers the composition the QA
 * run flagged: the wide table is md+ only with the card list below it, and a
 * failed read paints the console's own critical surface instead of a light
 * banner stranded in dark mode.
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
	getPathname: ({ href }: { href: string }) => href,
	usePathname: () => "/superadmin/tenants",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const mocks = vi.hoisted(() => ({ getTenantHealth: vi.fn(), gateMock: vi.fn() }));

vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: mocks.gateMock }));
vi.mock("@/lib/platform/tenant-health", () => ({ getTenantHealth: mocks.getTenantHealth }));

import SuperadminTenantsPage from "@/app/[locale]/(superadmin)/superadmin/tenants/page";
import { deviceStatusPolicyFromValue } from "@/lib/device-status";
import type { TenantHealthPage } from "@/lib/platform/tenant-health";
import {
	buildTenantHealthRows,
	paginateTenantRows,
	summarizeTenants,
} from "@/lib/platform/tenant-health-rules";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const MINUTE = 60 * 1000;
const POLICY = deviceStatusPolicyFromValue({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: 0 });

function health(sourceError = false): TenantHealthPage {
	const rows = sourceError
		? []
		: buildTenantHealthRows(
				[
					{
						orgId: "org-alpha",
						orgName: "Alpha Farm",
						orgStatus: "ACTIVE",
						members: 3,
						ponds: 2,
						devices: [{ id: "a1", lastSeenAt: new Date(NOW.getTime() - MINUTE) }],
						openAlerts: 1,
					},
				],
				NOW,
				POLICY,
			);
	const page = paginateTenantRows(rows, 1, 20);

	return {
		checkedAt: NOW,
		rows: page.rows,
		summary: summarizeTenants(rows),
		pagination: page.pagination,
		totalTenants: rows.length,
		truncated: false,
		sourceError,
		policyAvailable: !sourceError,
	};
}

async function html(sourceError = false): Promise<string> {
	mocks.getTenantHealth.mockResolvedValue(health(sourceError));
	const page = await SuperadminTenantsPage({ searchParams: Promise.resolve({}) });
	return renderToStaticMarkup(page);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.gateMock.mockResolvedValue(undefined);
});

describe("/superadmin/tenants", () => {
	it("renders the table from md up and the same rows as cards below it", async () => {
		const output = await html();

		expect(output).toContain("Alpha Farm");
		expect(output).toContain("hidden md:block");
		expect(output).toContain("md:hidden");
	});

	it("keeps the failed-read banner on the console's dark-aware critical surface", async () => {
		const output = await html(true);

		expect(output).toContain("bg-console-critical-surface");
		expect(output).toContain("text-console-critical-content");
		expect(output).not.toContain("#FDE8EA");
	});
});
