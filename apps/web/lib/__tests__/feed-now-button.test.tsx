import type { FeedNowLimit } from "@/lib/limits";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/pwa/use-online-status", () => ({
	useOnlineStatus: () => true,
}));

vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

const actionMocks = vi.hoisted(() => ({ requestFeed: vi.fn() }));

vi.mock("@/lib/actions/energy", () => ({
	requestFeed: actionMocks.requestFeed,
}));

import { FeedNowButton } from "@/components/FeedNowButton";
import { toast } from "sonner";

const limit: FeedNowLimit = {
	effectiveG: 2000,
	dailyCapG: 2000,
	usedTodayG: 0,
	remainingDailyG: 2000,
};

describe("FeedNowButton", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sends the scheduled dose when it is inside the remaining daily ceiling", async () => {
		actionMocks.requestFeed.mockResolvedValue({ success: true });

		render(
			<FeedNowButton
				deviceId="device-1"
				nextFeedingVolume="150g"
				label="Feed Now"
				feedNowLimit={{ ...limit, effectiveG: 400, usedTodayG: 1600, remainingDailyG: 400 }}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Feed Now" }));
		expect(screen.getByTestId("feed-now-limit-hint")).toHaveTextContent(
			"Feed Now limit: 400 g (remaining daily ceiling)",
		);
		fireEvent.click(screen.getByRole("button", { name: "Yes, Dispense Now" }));

		await waitFor(() => {
			expect(actionMocks.requestFeed).toHaveBeenCalledWith("device-1", 150);
		});
	});

	it("caps the dashboard dose to the remaining daily ceiling, not 1,000 g", async () => {
		actionMocks.requestFeed.mockResolvedValue({ success: true });

		render(
			<FeedNowButton
				deviceId="device-1"
				nextFeedingVolume="2110.06g"
				label="Feed Now"
				feedNowLimit={limit}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Feed Now" }));
		expect(screen.getByTestId("feed-now-limit-hint")).toHaveTextContent(
			"Feed Now limit: 2000 g (remaining daily ceiling)",
		);
		expect(screen.getByTestId("feed-now-limit-hint")).toHaveTextContent(
			"Sending 2000g, capped by today's remaining daily ceiling.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Yes, Dispense Now" }));

		await waitFor(() => {
			expect(actionMocks.requestFeed).toHaveBeenCalledWith("device-1", 2000);
		});
		expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Feed request sent"));
	});

	it("sends a dose above 1,000 g unchanged when the daily ceiling allows it", async () => {
		actionMocks.requestFeed.mockResolvedValue({ success: true });

		render(
			<FeedNowButton
				deviceId="device-1"
				nextFeedingVolume="1500g"
				label="Feed Now"
				feedNowLimit={{ ...limit, effectiveG: 5000, dailyCapG: 5000, remainingDailyG: 5000 }}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Feed Now" }));
		fireEvent.click(screen.getByRole("button", { name: "Yes, Dispense Now" }));

		await waitFor(() => {
			expect(actionMocks.requestFeed).toHaveBeenCalledWith("device-1", 1500);
		});
	});
});
