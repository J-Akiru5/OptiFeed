import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, optionsMock } = vi.hoisted(() => ({
	listMock: vi.fn(),
	optionsMock: vi.fn(),
}));

vi.mock("@/lib/actions/platform/devices", () => ({
	listPlatformDevices: listMock,
	getOrgPondOptions: optionsMock,
	registerDevice: vi.fn(),
	rotateDeviceToken: vi.fn(),
	remoteFeedDevice: vi.fn(),
	remoteSetDevicePause: vi.fn(),
}));
vi.mock("@/lib/actions/step-up", () => ({ startStepUp: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
	default: { energyDevice: { findMany: vi.fn(async () => []) } },
}));
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
		useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
	};
});

import SuperadminDevicesPage from "@/app/[locale]/(superadmin)/superadmin/devices/page";
import type { PlatformDeviceRow } from "@/lib/actions/platform/devices";

const devices: PlatformDeviceRow[] = [
	{
		id: "d1",
		label: "Pond 1 feeder",
		mac: "A4:CF:12:7E:3B:09",
		lastSeenAt: new Date(),
		createdAt: new Date("2026-10-01T02:00:00Z"),
		isPaused: false,
		pond: { id: "p1", name: "POND-01" },
		orgs: [{ id: "o1", name: "San Pablo Coop" }],
	},
	{
		id: "d2",
		label: "Pond 2 feeder",
		mac: "A4:CF:12:7E:3B:0A",
		lastSeenAt: null,
		createdAt: new Date("2026-10-02T02:00:00Z"),
		isPaused: true,
		pond: null,
		orgs: [],
	},
];

function page(params: Record<string, string> = {}) {
	return SuperadminDevicesPage({ searchParams: Promise.resolve(params) });
}

beforeEach(() => {
	listMock.mockReset();
	optionsMock.mockReset();
	optionsMock.mockResolvedValue([]);
	listMock.mockResolvedValue({ rows: devices, total: 2, page: 1, pageSize: 50 });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("/superadmin/devices layout (T-09c)", () => {
	it("keeps sticker selection working from both the cards and the table", async () => {
		const html = renderToStaticMarkup(await page());

		// One checkbox per device in the mobile list and one in the md+ table.
		expect(html.split('form="platform-device-label-form"').length - 1).toBe(4);
		expect(html).toContain('aria-label="Select Pond 1 feeder for sticker printing"');
		expect(html).toContain("md:hidden");
		expect(html).toContain("hidden md:block");
	});

	it("shows online/offline state and a formatted last-seen time", async () => {
		const html = renderToStaticMarkup(await page());

		expect(html).toContain("Online");
		expect(html).toContain("Offline");
		expect(html).toContain("Never");
		// formatDateTimeLocal's "full" form uses a bullet; toLocaleString() does not.
		expect(html).toContain(" • ");
	});

	it("uses scoped headers and an accessible table name", async () => {
		const html = renderToStaticMarkup(await page());
		expect(html.split('scope="col"').length - 1).toBe(8);
		expect(html).toContain("Platform device registry");
	});

	it("has an empty state that offers to clear a fruitless search", async () => {
		listMock.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 50 });
		const html = renderToStaticMarkup(await page({ q: "zzz" }));

		expect(html).toContain("No device matches “zzz”.");
		expect(html).toContain("Clear search");
	});

	it("keeps the wide remote-control panel out of the Actions cell (#213)", async () => {
		const html = renderToStaticMarkup(await page());

		// One compact trigger per device in the card view and one per row in the
		// table, collapsed by default.
		expect(html.split('data-help="superadmin-remote-feed"').length - 1).toBe(4);
		expect(html).toContain('aria-expanded="false"');

		// The panel (caps sentence, grams input, Feed button) is not rendered in
		// the row: it is mounted by its own full-width row when opened.
		expect(html).not.toContain("Commands use the normal server caps");
		expect(html).not.toContain("data-remote-feed-row");
	});
});
