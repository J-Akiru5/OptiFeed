"use client";

import { livePollDelayMs } from "@/lib/live/poll-policy";
import { useEffect, useRef } from "react";

export interface AdaptivePollOptions {
	/** Pause the poller entirely (the block is off screen, or the surface is disabled). */
	enabled?: boolean;
	/** A feed request is still pending/dispatched, so poll at the heartbeat cadence. */
	feedPending?: boolean;
	/** Run once when the poller starts instead of waiting a whole interval. */
	immediate?: boolean;
}

function isDocumentVisible(): boolean {
	return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * Poll on the interval policy in `lib/live/poll-policy.ts` (#731).
 *
 * A `setInterval` cannot change cadence, so this schedules the next poll with
 * `setTimeout` and re-reads the policy every tick. Two things are deliberate:
 *
 * - A hidden tab keeps **no** timer. It re-reads immediately on
 *   `visibilitychange`, so coming back to the tab is never stale, and a
 *   background tab costs nothing.
 * - The callback is held in a ref. Callers pass a fresh closure on every
 *   render; without the ref, each render would restart the timer and a
 *   component that re-renders often would never reach its interval.
 */
export function useAdaptivePoll(poll: () => void, options: AdaptivePollOptions = {}): void {
	const { enabled = true, feedPending = false, immediate = false } = options;
	const pollRef = useRef(poll);
	/** False until the current poller has started, so `immediate` fires once. */
	const startedRef = useRef(false);

	useEffect(() => {
		pollRef.current = poll;
	}, [poll]);

	useEffect(() => {
		if (!enabled) {
			// The next enable is a fresh start: poll once before waiting a whole
			// interval, so a surface that comes back is not stale for 30 s.
			startedRef.current = false;
			return;
		}
		// A tier change (a feed became pending, say) restarts the schedule but is
		// not a reason to poll again: the caller's own data is what changed.
		const starting = !startedRef.current;
		startedRef.current = true;
		let timer: number | undefined;
		let running = true;

		const clear = () => {
			if (timer === undefined) return;
			window.clearTimeout(timer);
			timer = undefined;
		};

		const schedule = () => {
			clear();
			const delay = livePollDelayMs({
				visible: isDocumentVisible(),
				feedPending,
			});
			if (delay === null) return;
			timer = window.setTimeout(tick, delay);
		};

		const tick = () => {
			timer = undefined;
			if (!running) return;
			pollRef.current();
			schedule();
		};

		const onVisibilityChange = () => {
			if (!running) return;
			if (!isDocumentVisible()) {
				clear();
				return;
			}
			// Catch up as soon as the tab is back, then resume the policy cadence.
			pollRef.current();
			schedule();
		};

		if (immediate && starting && isDocumentVisible()) pollRef.current();
		schedule();
		document.addEventListener("visibilitychange", onVisibilityChange);

		return () => {
			running = false;
			clear();
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, [enabled, feedPending, immediate]);
}
