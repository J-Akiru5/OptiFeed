import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock("@/lib/calendar/platform-events", () => ({
	listPlatformCalendarEvents: listMock,
}));

vi.mock("@/components/superadmin/platform-calendar", () => ({
	PlatformCalendar: ({ initialData }: { initialData: { events: unknown[] } }) => (
		<div data-testid="platform-calendar">{`events:${initialData.events.length}`}</div>
	),
}));

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getLocale: async () => "en",
		getTranslations: async (namespace: string) => createTranslator(namespace),
	};
});

import SuperadminCalendarPage from "@/app/[locale]/(superadmin)/superadmin/calendar/page";
import type { PlatformCalendarData } from "@/lib/calendar/platform-events";

const data: PlatformCalendarData = {
	events: [],
	truncated: false,
	from: "2026-02-01",
	to: "2026-02-10",
	filters: {
		from: "2026-02-01",
		to: "2026-02-10",
		orgIds: [],
		pondId: "all",
		types: ["harvest", "sampling", "manual", "device"],
	},
	orgs: [],
	ponds: [],
};

function page(params: Record<string, string | string[]> = {}) {
	return SuperadminCalendarPage({ searchParams: Promise.resolve(params) });
}

beforeEach(() => {
	listMock.mockReset();
	listMock.mockResolvedValue(data);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("/superadmin/calendar page", () => {
	it("renders the console header in the selected locale", async () => {
		const html = renderToStaticMarkup(await page());

		expect(html).toContain("Platform calendar");
		expect(html).toContain("Read-only");
		expect(html).toContain("events:0");
	});

	it("passes every URL filter to the gated loader", async () => {
		await page({ orgs: "org-a,org-b", pond: "pond-a", types: "device" });

		expect(listMock).toHaveBeenCalledWith({
			orgs: "org-a,org-b",
			pond: "pond-a",
			types: "device",
		});
	});

	it("denies a non-platform admin before rendering the calendar", async () => {
		listMock.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(page()).rejects.toThrow("NEXT_REDIRECT");
	});
});
