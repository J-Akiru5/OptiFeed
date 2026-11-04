/**
 * How often the browser re-reads a device surface (#731).
 *
 * The one place that decides the cadence. A device reading can only change when
 * the unit checks in, and the firmware polls the server on a fixed 5 s
 * heartbeat (`docs/performance/device-polling-scale-plan.md`), so 5 s is the
 * fastest a poll can return anything new — a shorter interval re-reads the same
 * row and pays a function invocation for it. The previous code hard-coded an
 * interval per component (and the scale review found the device poll itself at
 * 5 s per endpoint), so the tiers live here instead: a caller passes what it
 * knows (is the tab visible, is a feed still pending) and never picks a number.
 *
 * `HopperLiveDistance` is the one deliberate exception. It runs only while an
 * operator has the calibration panel on screen and needs to watch the raw
 * distance move under their hand, so it keeps its own tighter
 * `HOPPER_DISTANCE_POLL_MS` rather than the idle tier here.
 *
 * Tiers:
 *
 * - `fast` (5 s) — visible, and a feed request is queued or in flight. The
 *   operator is waiting for an answer, and the unit can produce one per
 *   heartbeat, so this is the fastest cadence that is not wasted work.
 * - `idle` (30 s) — visible, nothing waiting on the device. Readings only move
 *   on a heartbeat and no surface is waiting for a reply, so the poll backs off
 *   instead of spending a request every 5 s to see the same value. This matches
 *   the dashboard's existing revalidation cadence.
 * - `hidden` — no timer at all. A hidden tab cannot show the value, and the
 *   `visibilitychange` catch-up in `useAdaptivePoll` re-reads immediately when
 *   the tab comes back, so a 60 s "still polling" tier would only spend
 *   requests nobody can see.
 */

/** Milliseconds between polls, or `null` for "do not schedule one". */
export const LIVE_POLL_MS = {
	fast: 5_000,
	idle: 30_000,
	hidden: null,
} as const;

export type LivePollTier = keyof typeof LIVE_POLL_MS;

export interface LivePollInput {
	/** `document.visibilityState === "visible"`. */
	visible: boolean;
	/** A feed request for the device is still `pending` or `dispatched`. */
	feedPending: boolean;
}

/**
 * The tier for the current state. Kept separate from the delay so a caller (or
 * a test) can assert the decision without depending on the millisecond values.
 */
export function livePollTier({ visible, feedPending }: LivePollInput): LivePollTier {
	if (!visible) return "hidden";
	return feedPending ? "fast" : "idle";
}

/** Milliseconds to wait before the next poll, or `null` to stop polling. */
export function livePollDelayMs(input: LivePollInput): number | null {
	return LIVE_POLL_MS[livePollTier(input)];
}
