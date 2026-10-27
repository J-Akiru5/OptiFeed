import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
