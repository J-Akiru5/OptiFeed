"use client";

import { useAdaptivePoll } from "@/lib/live/use-adaptive-poll";
import { useRouter } from "next/navigation";

/**
 * Keep the server-rendered device surfaces fresh (#263).
 *
 * The sidebar lives in the dashboard layout, which App Router keeps mounted
 * across client navigations. Without a revalidation the sidebar could show the
 * hopper level from when the session first loaded while the page below it
 * showed the current one — the 24 % vs 37 % mismatch Jeff reported.
 *
 * A visibility-aware `router.refresh()` is the app's existing revalidation
 * mechanism (the same call every action uses after a write). It re-renders the
 * server components, so the sidebar, the dashboard card, the History card and
 * any open settings page all read the same fresh device row.
 *
 * The cadence is the shared policy (#731), not a fixed interval: the hopper
 * level, water temperature, RTC bit and the pending-feed banner all come from
 * this one refresh, so it polls at the heartbeat cadence only while a feed is
 * still pending and otherwise backs off. See `lib/live/poll-policy.ts`.
 */
interface DashboardLiveRefreshProps {
	/** Disable while there is no device to watch (no pond / platform admin). */
	enabled?: boolean;
	/** A feed request is still pending/dispatched, so refresh at the fast tier. */
	pendingFeedRequest?: boolean;
}

export function DashboardLiveRefresh({
	enabled = true,
	pendingFeedRequest = false,
}: DashboardLiveRefreshProps) {
	const router = useRouter();

	// Not immediate: the server just rendered this payload. The first refresh is
	// one interval away, or immediately when the tab becomes visible again.
	useAdaptivePoll(() => router.refresh(), { enabled, feedPending: pendingFeedRequest });

	return null;
}
