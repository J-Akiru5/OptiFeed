import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh }),
}));

import {
	DashboardLiveRefresh,
	LIVE_REFRESH_INTERVAL_MS,
} from "@/components/dashboard-live-refresh";

describe("DashboardLiveRefresh (#263)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mocks.refresh.mockClear();
	});

	it("revalidates the server surfaces on the shared interval", () => {
		render(<DashboardLiveRefresh />);

		act(() => {
			vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS);
		});

		expect(mocks.refresh).toHaveBeenCalledTimes(1);
	});

	it("does no work while disabled and stops when unmounted", () => {
		const { rerender, unmount } = render(<DashboardLiveRefresh enabled={false} />);

		act(() => {
			vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 2);
		});
		expect(mocks.refresh).not.toHaveBeenCalled();

		rerender(<DashboardLiveRefresh enabled />);
		act(() => {
			vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS);
		});
		expect(mocks.refresh).toHaveBeenCalledTimes(1);

		unmount();
		act(() => {
			vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 2);
		});
		expect(mocks.refresh).toHaveBeenCalledTimes(1);
	});
});
