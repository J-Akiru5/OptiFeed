import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	gate: vi.fn(),
	list: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: {} }));

vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: mocks.gate,
}));

vi.mock("@/lib/platform/issue-reports", () => ({
	listIssueReports: mocks.list,
}));

vi.mock("@/components/superadmin/resolve-report-button", async () => {
	const react = await import("react");
	return {
		ResolveReportButton: ({ id }: { id: string }) =>
			react.createElement("button", { type: "button", "data-report-id": id }, "resolve-stub"),
	};
});

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
		Link: ({ href, children, ...rest }: { href: unknown; children?: React.ReactNode }) =>
			react.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
		getPathname: ({ href }: { href: string }) => href,
		usePathname: () => "/superadmin/operations/reports",
		useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
	};
});

import OperationsReportsPage from "@/app/[locale]/(superadmin)/superadmin/operations/reports/page";
import { formatFarmDateTime } from "@/lib/date-local";
import { createTranslator } from "./helpers/messages";

const REPORTS = [
	{
		id: "rep-1",
		category: "BUG" as const,
		message: "Feeder stopped after the firmware update",
		email: null,
		pagePath: "/en/dashboard",
		locale: "en",
		source: "PUBLIC" as const,
		status: "OPEN" as const,
		createdAt: "2026-10-31T08:00:00.000Z",
		resolvedAt: null,
	},
	{
		id: "rep-2",
		category: "CONTENT" as const,
		message: "The schedule label is misspelled",
		email: "ops@example.com",
		pagePath: null,
		locale: "en",
		source: "ASSISTANT" as const,
		status: "RESOLVED" as const,
		createdAt: "2026-10-30T08:00:00.000Z",
		resolvedAt: "2026-10-30T09:00:00.000Z",
	},
];

const t = createTranslator("superadmin.operations.reports");
const tDates = createTranslator("dates");

function page() {
	return OperationsReportsPage();
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.gate.mockResolvedValue(undefined);
	mocks.list.mockResolvedValue(REPORTS);
});

describe("/superadmin/operations/reports", () => {
	it("renders each report with its category, source and status labels", async () => {
		const html = renderToStaticMarkup(await page());

		expect(html).toContain("Feeder stopped after the firmware update");
		expect(html).toContain("The schedule label is misspelled");
		expect(html).toContain(t("categories.BUG"));
		expect(html).toContain(t("categories.CONTENT"));
		expect(html).toContain(t("sources.PUBLIC"));
		expect(html).toContain(t("sources.ASSISTANT"));
		expect(html).toContain(t("statuses.OPEN"));
		expect(html).toContain(t("statuses.RESOLVED"));
	});

	it("offers resolve only on open reports and shows the resolved date otherwise", async () => {
		const html = renderToStaticMarkup(await page());

		expect(html).toContain('data-report-id="rep-1"');
		expect(html).not.toContain('data-report-id="rep-2"');
		expect(html).toContain(
			t("resolvedAt", {
				when: formatFarmDateTime(new Date("2026-10-30T09:00:00.000Z"), tDates).full,
			}),
		);
	});

	it("shows an empty state instead of an empty queue", async () => {
		mocks.list.mockResolvedValue([]);

		const html = renderToStaticMarkup(await page());

		expect(html).toContain(t("emptyTitle"));
		expect(html).not.toContain("data-report-id");
	});

	it("denies a caller without an active PlatformAdmin row before loading data", async () => {
		mocks.gate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(page()).rejects.toThrow("NEXT_REDIRECT");

		expect(mocks.list).not.toHaveBeenCalled();
	});
});
