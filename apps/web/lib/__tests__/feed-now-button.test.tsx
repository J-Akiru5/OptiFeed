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
	effectiveG: 1000,
	perMealCeilingG: 1000,
	hardCeilingG: 1000,
	remainingDailyG: 2000,
	source: "hard_ceiling",
};

describe("FeedNowButton", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sends the scheduled dose when it is inside the effective limit", async () => {
		actionMocks.requestFeed.mockResolvedValue({ success: true });

		render(
			<FeedNowButton
				deviceId="device-1"
				nextFeedingVolume="150g"
				label="Feed Now"
				feedNowLimit={{ ...limit, effectiveG: 400, perMealCeilingG: 400, source: "pond_per_meal" }}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Feed Now" }));
		expect(screen.getByTestId("feed-now-limit-hint")).toHaveTextContent(
			"Feed Now limit: 400 g (pond per-meal ceiling)",
		);
		fireEvent.click(screen.getByRole("button", { name: "Yes, Dispense Now" }));

		await waitFor(() => {
			expect(actionMocks.requestFeed).toHaveBeenCalledWith("device-1", 150);
		});
	});

	it("caps the dashboard dose to the hard ceiling and says so", async () => {
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
			"Feed Now limit: 1000 g (absolute safety ceiling)",
		);
		expect(screen.getByTestId("feed-now-limit-hint")).toHaveTextContent(
			"Sending 1000g, capped by this limit.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Yes, Dispense Now" }));

		await waitFor(() => {
			expect(actionMocks.requestFeed).toHaveBeenCalledWith("device-1", 1000);
		});
		expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Feed request sent"));
	});
});
