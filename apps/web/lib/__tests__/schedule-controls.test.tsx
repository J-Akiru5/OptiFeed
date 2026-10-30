import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FeedNowLimit } from "@/lib/limits";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/lib/pwa/use-feed-guard", () => ({
	useFeedCommandGuard: () => ({ online: true, reason: undefined, blockIfOffline: () => false }),
}));

const actionMocks = vi.hoisted(() => ({
	toggleDevicePause: vi.fn(),
	requestFeed: vi.fn(),
}));

vi.mock("@/lib/actions/schedule", () => ({
	toggleDevicePause: actionMocks.toggleDevicePause,
}));

vi.mock("@/lib/actions/energy", () => ({
	requestFeed: actionMocks.requestFeed,
}));

import { ScheduleControls } from "@/components/ScheduleControls";
import { toast } from "sonner";

describe("ScheduleControls", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reverts the optimistic pause when the server refuses", async () => {
		actionMocks.toggleDevicePause.mockRejectedValue(
			new Error("This pond is fallow after harvest."),
		);

		render(<ScheduleControls deviceId="device-1" initialIsPaused={false} />);

		// The controls start on "running" and offer Pause.
		expect(screen.getByRole("button", { name: "Pause Schedule" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Pause Schedule" }));

		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith("This pond is fallow after harvest.");
		});
		// The optimistic flip must not survive a rejected write.
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Pause Schedule" })).toBeTruthy();
		});
		expect(screen.queryByRole("button", { name: "Resume Schedule" })).toBeNull();
	});

	it("keeps the new state when the server accepts", async () => {
		actionMocks.toggleDevicePause.mockResolvedValue(undefined);

		render(<ScheduleControls deviceId="device-1" initialIsPaused={false} />);
		fireEvent.click(screen.getByRole("button", { name: "Pause Schedule" }));

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Resume Schedule" })).toBeTruthy();
		});
		expect(actionMocks.toggleDevicePause).toHaveBeenCalledWith("device-1", true);
	});

	it("caps the fixed Feed Now dose to the effective limit and shows the reason", async () => {
		actionMocks.requestFeed.mockResolvedValue({ success: true });
		const feedNowLimit: FeedNowLimit = {
			effectiveG: 400,
			perMealCeilingG: 400,
			hardCeilingG: 1000,
			remainingDailyG: 2000,
			source: "pond_per_meal",
		};

		render(
			<ScheduleControls
				deviceId="device-1"
				initialIsPaused={false}
				gramsPerFeeding={1000}
				feedNowLimit={feedNowLimit}
			/>,
		);

		expect(screen.getByText(/Feed Now limit: 400 g/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Feed Now" }));
		fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

		await waitFor(() => {
			expect(actionMocks.requestFeed).toHaveBeenCalledWith("device-1", 400);
		});
	});

	it("surfaces the server's actionable limit message instead of a generic toast", async () => {
		const message =
			"Feed Now limit is 400 g (pond per-meal ceiling). Change the pond feeding rate or meals per day in Settings > Pond.";
		actionMocks.requestFeed.mockResolvedValue({ success: false, error: message });

		render(
			<ScheduleControls
				deviceId="device-1"
				initialIsPaused={false}
				gramsPerFeeding={150}
				feedNowLimit={{
					effectiveG: 400,
					perMealCeilingG: 400,
					hardCeilingG: 1000,
					remainingDailyG: 2000,
					source: "pond_per_meal",
				}}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Feed Now" }));
		fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(message);
		});
	});
});
