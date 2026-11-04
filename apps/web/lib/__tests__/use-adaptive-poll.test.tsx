import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIVE_POLL_MS } from "@/lib/live/poll-policy";
import { useAdaptivePoll } from "@/lib/live/use-adaptive-poll";

/**
 * #731: the scheduler itself. Counts polls over simulated wall-clock time, so
 * the reported request rates come from the code under test rather than from a
 * hand-written constant.
 */

let visibility: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState) {
	visibility = next;
	act(() => {
		document.dispatchEvent(new Event("visibilitychange"));
	});
}

function Poller({
	poll,
	feedPending = false,
	enabled = true,
}: {
	poll: () => void;
	feedPending?: boolean;
	enabled?: boolean;
}) {
	useAdaptivePoll(poll, { enabled, feedPending, immediate: true });
	return null;
}

function advance(ms: number) {
	act(() => {
		vi.advanceTimersByTime(ms);
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	visibility = "visible";
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => visibility,
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("useAdaptivePoll (#731)", () => {
	it("polls once on start, then every 30 s when nothing is pending", () => {
		const poll = vi.fn();
		render(<Poller poll={poll} />);

		expect(poll).toHaveBeenCalledTimes(1);

		advance(LIVE_POLL_MS.idle - 1);
		expect(poll).toHaveBeenCalledTimes(1);

		// 60 s of idle visible time → the first poll plus two ticks.
		advance(1 + LIVE_POLL_MS.idle);
		expect(poll).toHaveBeenCalledTimes(3);
	});

	it("polls every 5 s while a feed is pending", () => {
		const poll = vi.fn();
		render(<Poller poll={poll} feedPending />);

		expect(poll).toHaveBeenCalledTimes(1);

		advance(60_000);
		// 12 fast ticks in a minute, on top of the immediate one.
		expect(poll).toHaveBeenCalledTimes(13);
	});

	it("schedules nothing while the tab is hidden and catches up on return", () => {
		visibility = "hidden";
		const poll = vi.fn();
		render(<Poller poll={poll} />);

		expect(poll).not.toHaveBeenCalled();
		advance(120_000);
		expect(poll).not.toHaveBeenCalled();

		setVisibility("visible");
		expect(poll).toHaveBeenCalledTimes(1);

		advance(LIVE_POLL_MS.idle);
		expect(poll).toHaveBeenCalledTimes(2);
	});

	it("drops the timer when the tab is hidden", () => {
		const poll = vi.fn();
		render(<Poller poll={poll} feedPending />);

		advance(LIVE_POLL_MS.fast);
		expect(poll).toHaveBeenCalledTimes(2);

		setVisibility("hidden");
		advance(60_000);
		expect(poll).toHaveBeenCalledTimes(2);

		setVisibility("visible");
		expect(poll).toHaveBeenCalledTimes(3);
	});

	it("does nothing while disabled", () => {
		const poll = vi.fn();
		render(<Poller poll={poll} enabled={false} />);

		advance(60_000);
		expect(poll).not.toHaveBeenCalled();
	});

	it("polls immediately when it is enabled", () => {
		const poll = vi.fn();
		const { rerender } = render(<Poller poll={poll} enabled={false} />);

		rerender(<Poller poll={poll} />);

		expect(poll).toHaveBeenCalledTimes(1);
	});

	it("keeps the cadence when the caller re-renders with a new callback", () => {
		const first = vi.fn();
		const { rerender } = render(<Poller poll={first} />);
		expect(first).toHaveBeenCalledTimes(1);

		advance(LIVE_POLL_MS.idle - 1);
		const second = vi.fn();
		rerender(<Poller poll={second} />);
		expect(second).not.toHaveBeenCalled();

		// The render must not restart the timer: one tick is due in 1 ms.
		advance(1);
		expect(second).toHaveBeenCalledTimes(1);
	});

	it("stops polling on unmount", () => {
		const poll = vi.fn();
		const { unmount } = render(<Poller poll={poll} feedPending />);
		expect(poll).toHaveBeenCalledTimes(1);

		unmount();
		advance(60_000);
		expect(poll).toHaveBeenCalledTimes(1);
	});
});
