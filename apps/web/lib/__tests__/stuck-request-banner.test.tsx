import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/pwa/use-feed-guard", () => ({
	useFeedCommandGuard: () => ({ online: true, reason: undefined, blockIfOffline: () => false }),
}));

vi.mock("@/lib/actions/schedule", () => ({ updateScheduleCommand: vi.fn() }));
vi.mock("@/lib/actions/energy", () => ({ requestFeed: vi.fn() }));

// The real Link adds the active locale prefix; here it just has to prove the
// banner uses the locale-aware router instead of a bare <a href>.
vi.mock("@/i18n/routing", () => ({
	Link: ({
		href,
		children,
		...rest
	}: { href: string; children?: React.ReactNode } & Record<string, unknown>) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

import { StuckRequestBanner } from "@/components/StuckRequestBanner";

const baseProps = {
	stuckFeedRequests: [],
	stuckScheduleCommands: [],
	deviceOffline: false,
	deviceLastSeenAt: null,
	deviceId: "device-1",
	pondId: "pond-1",
	scheduleStart: "06:00",
	scheduleEnd: "16:00",
	feedsPerDay: 3,
	feedingRatePct: 3,
};

describe("StuckRequestBanner", () => {
	it("shows the offline time on the farm clock", () => {
		// 18:00 UTC is 02:00 the next day in Asia/Manila.
		render(
			<StuckRequestBanner
				{...baseProps}
				deviceOffline
				deviceLastSeenAt="2026-10-27T18:00:00.000Z"
			/>,
		);

		expect(screen.getByText(/2:00 AM/)).toBeTruthy();
	});

	it("links to hardware with the locale-aware router", () => {
		render(
			<StuckRequestBanner
				{...baseProps}
				deviceOffline
				deviceLastSeenAt="2026-10-27T18:00:00.000Z"
			/>,
		);

		const link = screen.getByRole("link", { name: "Check Device" });
		expect(link.getAttribute("href")).toBe("/dashboard/settings/hardware");
	});
});
