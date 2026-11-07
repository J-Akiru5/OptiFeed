import { LastSeenValue, formatLastSeenAge } from "@/components/status/last-seen-value";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #891: the device "last seen" value switches to days at the day threshold and
 * keeps ticking, instead of freezing at the first render.
 *
 * The fake clock stops at 23h55m so crossing midnight costs ten one-minute
 * ticks rather than hundreds; the point is that the mounted component moves,
 * not that the interval is fast.
 */

const NOW = new Date("2026-11-07T12:00:00.000Z");

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function ago(ms: number): Date {
	return new Date(NOW.getTime() - ms);
}

describe("last seen value (#891)", () => {
	it("reads hours below a day", () => {
		render(<LastSeenValue at={ago(2 * 60 * 60 * 1000 + 30 * 60 * 1000)} />);
		expect(screen.getByText("2h ago")).toBeTruthy();
	});

	it("switches to days on the minute tick without a reload", () => {
		render(<LastSeenValue at={ago(23 * 60 * 60 * 1000 + 55 * 60 * 1000)} />);
		expect(screen.getByText("23h ago")).toBeTruthy();

		act(() => {
			vi.advanceTimersByTime(10 * 60 * 1000);
		});

		expect(screen.getByText("1d ago")).toBeTruthy();
		expect(screen.queryByText("23h ago")).toBeNull();
	});

	it("formats a three-day outage in days, not hours", () => {
		expect(formatLastSeenAge(ago(75 * 60 * 60 * 1000), NOW.getTime())).toBe("3d ago");
	});

	it("says Never when the device has not been seen", () => {
		expect(formatLastSeenAge(null, NOW.getTime())).toBe("Never");
	});
});
