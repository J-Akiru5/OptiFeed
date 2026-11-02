import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Organization comparison page (issue #479, M3C.9).
 *
 * The loader and rules cover the numbers; these cover what the operator sees:
 * a failed read, a selection too short to compare, an unmeasured tenant, and the
 * normal side-by-side table with its "best" marks.
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
	usePathname: () => "/superadmin/tenants/compare",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const mocks = vi.hoisted(() => ({ getOrgComparison: vi.fn(), gateMock: vi.fn() }));

vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: mocks.gateMock }));
vi.mock("@/lib/platform/org-comparison", () => ({ getOrgComparison: mocks.getOrgComparison }));

import TenantComparisonPage from "@/app/[locale]/(superadmin)/superadmin/tenants/compare/page";
import { deviceStatusPolicyFromValue } from "@/lib/device-status";
import type { OrgComparisonPage } from "@/lib/platform/org-comparison";
import { buildOrgComparison, parseComparisonSelection } from "@/lib/platform/org-comparison-rules";
import { type TenantHealthRow, buildTenantHealthRows } from "@/lib/platform/tenant-health-rules";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const MINUTE = 60 * 1000;
const POLICY = deviceStatusPolicyFromValue({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: 0 });

const ROWS: TenantHealthRow[] = buildTenantHealthRows(
	[
		{
			orgId: "org-alpha",
			orgName: "Alpha Farm",
			orgStatus: "ACTIVE",
			members: 3,
			ponds: 2,
			devices: [
				{ id: "a1", lastSeenAt: new Date(NOW.getTime() - MINUTE) },
				{ id: "a2", lastSeenAt: new Date(NOW.getTime() - MINUTE) },
			],
			openAlerts: 2,
		},
		{
			orgId: "org-beta",
			orgName: "Beta Farm",
			orgStatus: "ACTIVE",
			members: 1,
			ponds: 1,
			devices: [
				{ id: "b1", lastSeenAt: new Date(NOW.getTime() - 120 * MINUTE) },
				{ id: "b2", lastSeenAt: new Date(NOW.getTime() - 180 * MINUTE) },
			],
			openAlerts: 4,
		},
		{
			orgId: "org-gamma",
			orgName: "Gamma Farm",
			orgStatus: "ACTIVE",
			members: 0,
			ponds: 0,
			devices: [],
			openAlerts: 0,
		},
	],
	NOW,
	POLICY,
);

function makePage(rawSelection: string[] | undefined): OrgComparisonPage {
	const available = ROWS.map((row) => row.orgId);
	const selection = parseComparisonSelection(rawSelection, available);
	return {
		checkedAt: NOW,
		selection,
		comparison: buildOrgComparison(ROWS, selection.selected),
		options: ROWS.map((row) => ({ orgId: row.orgId, orgName: row.orgName, state: row.state })),
		available: ROWS.length,
		truncated: false,
		sourceError: false,
		policyAvailable: true,
	};
}

const FAILED: OrgComparisonPage = {
	checkedAt: NOW,
	selection: { selected: [], droppedOrgIds: [], truncated: false },
	comparison: buildOrgComparison([], []),
	options: [],
	available: 0,
	truncated: false,
	sourceError: true,
	policyAvailable: false,
};

async function html(selection?: string[]): Promise<string> {
	const page = await TenantComparisonPage({
		searchParams: Promise.resolve(selection ? { org: selection } : {}),
	});
	return renderToStaticMarkup(page as React.ReactElement);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.gateMock.mockResolvedValue(undefined);
	mocks.getOrgComparison.mockImplementation(async (raw: string[] | undefined) => makePage(raw));
});

describe("comparison page", () => {
	it("says the read failed instead of showing an empty comparison", async () => {
		mocks.getOrgComparison.mockResolvedValue(FAILED);

		const output = await html();

		expect(output).toContain("The comparison could not be read");
		expect(output).toContain("would not mean the tenants are fine");
		expect(output).not.toContain("Choose two to four organizations");
		expect(output).not.toContain("Nothing selected yet");
	});

	it("asks for a selection before comparing anything", async () => {
		const output = await html();

		expect(output).toContain("Nothing selected yet");
		expect(output).toContain("Tick two organizations above");
		expect(output).toContain("Choose two to four organizations");
	});

	it("explains that one organization is not a comparison", async () => {
		const output = await html(["org-alpha"]);

		expect(output).toContain("One organization is not a comparison");
		expect(output).not.toContain("Side by side");
	});

	it("compares the selection worst first and marks the best measured value", async () => {
		const output = await html(["org-alpha", "org-beta"]);

		expect(output).toContain("Beta Farm");
		expect(output).toContain("Alpha Farm");
		expect(output.indexOf("Beta Farm")).toBeLessThan(output.indexOf("Alpha Farm"));
		expect(output).toContain("Best");
		expect(output).toContain("100%");
	});

	it("calls an unmeasured organization unknown, never healthy", async () => {
		const output = await html(["org-gamma", "org-alpha"]);

		expect(output).toContain("Gamma Farm");
		expect(output).toContain("Unknown");
		expect(output).toContain("no measured fleet");
		expect(output).toContain("Not reported");
	});

	it("warns about ids that no longer exist", async () => {
		const output = await html(["org-alpha", "org-deleted"]);

		expect(output).toContain("no longer exist and were ignored");
	});

	it("keeps the picker so the selection can be changed without leaving the page", async () => {
		const output = await html(["org-alpha", "org-beta"]);

		expect(output).toContain('type="checkbox"');
		expect(output).toContain('value="org-gamma"');
		expect(output).toContain("Compare selected");
	});
});
