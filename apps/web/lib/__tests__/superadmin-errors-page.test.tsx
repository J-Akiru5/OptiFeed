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

vi.mock("@/lib/platform/error-events", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/platform/error-events")>()),
	listErrorEvents: mocks.list,
}));

vi.mock("@/components/superadmin/resolve-error-button", async () => {
	const react = await import("react");
	return {
		ResolveErrorButton: ({ id }: { id: string }) =>
			react.createElement("button", { type: "button", "data-error-id": id }, "resolve-stub"),
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
		usePathname: () => "/superadmin/operations/errors",
		useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
	};
});

import OperationsErrorsPage from "@/app/[locale]/(superadmin)/superadmin/operations/errors/page";

const ROWS = [
	{
		id: "err-1",
		message: "hopper sensor missing",
		stack: "Error: hopper sensor missing\n    at feed (lib/feed.ts:42:7)",
		route: "ingest",
		severity: "ERROR" as const,
		count: 3,
		firstSeenAt: new Date("2026-10-29T08:00:00.000Z"),
		lastSeenAt: new Date("2026-10-29T09:00:00.000Z"),
		resolved: false,
		resolvedAt: null,
		resolvedBy: null,
	},
	{
		id: "err-2",
		message: "heartbeat arrived late",
		stack: null,
		route: "cron/device-watch",
		severity: "WARNING" as const,
		count: 1,
		firstSeenAt: new Date("2026-10-28T08:00:00.000Z"),
		lastSeenAt: new Date("2026-10-28T09:00:00.000Z"),
		resolved: true,
		resolvedAt: null,
		resolvedBy: "admin-1",
	},
];

function page(params: Record<string, string> = {}) {
	return OperationsErrorsPage({ searchParams: Promise.resolve(params) });
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.gate.mockResolvedValue(undefined);
	mocks.list.mockResolvedValue({ rows: ROWS, total: 2, page: 1, pageSize: 20 });
});

describe("/superadmin/operations/errors", () => {
	it("renders the captured error, its count, route and expandable stack", async () => {
		const html = renderToStaticMarkup(await page());

		expect(html).toContain("Error events");
		expect(html).toContain("30 days");
		expect(html).toContain("hopper sensor missing");
		expect(html).toContain("ingest");
		expect(html).toContain("3 occurrences");
		expect(html).toContain("<details");
		expect(html).toContain("Show stack trace");
		expect(html).toContain("at feed (lib/feed.ts:42:7)");
	});

	it("offers resolve only on unresolved rows", async () => {
		const html = renderToStaticMarkup(await page());

		expect(html).toContain('data-error-id="err-1"');
		expect(html).not.toContain('data-error-id="err-2"');
		expect(html).toContain("Resolved");
	});

	it("renders the three status filters and marks the active one", async () => {
		const html = renderToStaticMarkup(await page({ status: "resolved" }));

		expect(html).toContain('href="/superadmin/operations/errors"');
		expect(html).toContain('href="/superadmin/operations/errors?status=resolved"');
		expect(html).toContain('href="/superadmin/operations/errors?status=all"');
		expect(html).toContain('aria-current="page"');
		expect(mocks.list).toHaveBeenCalledWith({ status: "resolved", page: 1 });
	});

	it("shows an empty state instead of an empty list", async () => {
		mocks.list.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });

		const html = renderToStaticMarkup(await page());

		expect(html).toContain("No error events");
		expect(html).not.toContain("<details");
	});

	it("denies a caller without an active PlatformAdmin row before loading data", async () => {
		mocks.gate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(page()).rejects.toThrow("NEXT_REDIRECT");

		expect(mocks.list).not.toHaveBeenCalled();
	});
});
