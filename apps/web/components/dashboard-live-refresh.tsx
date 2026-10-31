"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

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
 * any open settings page all read the same fresh device row. Hidden tabs do no
 * work.
 */
export const LIVE_REFRESH_INTERVAL_MS = 30_000;

interface DashboardLiveRefreshProps {
	/** Disable while there is no device to watch (no pond / platform admin). */
	enabled?: boolean;
	intervalMs?: number;
}

export function DashboardLiveRefresh({
	enabled = true,
	intervalMs = LIVE_REFRESH_INTERVAL_MS,
}: DashboardLiveRefreshProps) {
	const router = useRouter();

	useEffect(() => {
		if (!enabled) return;

		const refreshIfVisible = () => {
			if (document.visibilityState === "visible") router.refresh();
		};

		const timer = window.setInterval(refreshIfVisible, intervalMs);
		document.addEventListener("visibilitychange", refreshIfVisible);

		return () => {
			window.clearInterval(timer);
			document.removeEventListener("visibilitychange", refreshIfVisible);
		};
	}, [enabled, intervalMs, router]);

	return null;
}
