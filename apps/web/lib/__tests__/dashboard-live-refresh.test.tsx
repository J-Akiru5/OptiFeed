import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh }),
}));

import { DashboardLiveRefresh } from "@/components/dashboard-live-refresh";
import { LIVE_POLL_MS } from "@/lib/live/poll-policy";

/**
 * #263 kept the server-rendered device surfaces fresh; #731 made the cadence
 * adaptive. The hopper level, water temperature, RTC bit and the pending-feed
 * banner all ride this one refresh, so the tiers here are the freshness
 * contract for those values.
 */

let visibility: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState) {
	visibility = next;
	act(() => {
		document.dispatchEvent(new Event("visibilitychange"));
	});
}

function advance(ms: number) {
	act(() => {
		vi.advanceTimersByTime(ms);
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	mocks.refresh.mockClear();
	visibility = "visible";
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => visibility,
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("DashboardLiveRefresh (#263, #731)", () => {
	it("revalidates on the idle interval when nothing is pending", () => {
		render(<DashboardLiveRefresh />);

		// The server just rendered the payload, so nothing happens on mount.
		expect(mocks.refresh).not.toHaveBeenCalled();

		advance(LIVE_POLL_MS.idle);
		expect(mocks.refresh).toHaveBeenCalledTimes(1);
	});

	it("refreshes at the heartbeat cadence while a feed request is pending", () => {
		render(<DashboardLiveRefresh pendingFeedRequest />);

		advance(LIVE_POLL_MS.fast);
		expect(mocks.refresh).toHaveBeenCalledTimes(1);

		advance(60_000);
		// A minute of a pending feed at the fast tier (12 ticks) plus the first.
		expect(mocks.refresh).toHaveBeenCalledTimes(13);
	});

	it("does no work while the tab is hidden and catches up when it returns", () => {
		visibility = "hidden";
		render(<DashboardLiveRefresh />);

		advance(120_000);
		expect(mocks.refresh).not.toHaveBeenCalled();

		setVisibility("visible");
		expect(mocks.refresh).toHaveBeenCalledTimes(1);

		advance(LIVE_POLL_MS.idle);
		expect(mocks.refresh).toHaveBeenCalledTimes(2);
	});

	it("does no work while disabled and stops when unmounted", () => {
		const { rerender, unmount } = render(<DashboardLiveRefresh enabled={false} />);

		advance(LIVE_POLL_MS.idle * 2);
		expect(mocks.refresh).not.toHaveBeenCalled();

		rerender(<DashboardLiveRefresh enabled />);
		advance(LIVE_POLL_MS.idle);
		expect(mocks.refresh).toHaveBeenCalledTimes(1);

		unmount();
		advance(LIVE_POLL_MS.idle * 2);
		expect(mocks.refresh).toHaveBeenCalledTimes(1);
	});
});
