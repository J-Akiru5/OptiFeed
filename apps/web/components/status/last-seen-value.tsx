"use client";

import { elapsedParts, relativeAge } from "@/lib/relative-time";
import { useEffect, useState } from "react";

/**
 * #891: a "last seen" value that keeps moving.
 *
 * The card used to compute `Date.now() - lastSeenAt` during render, so the
 * string froze at whatever the first paint said until something else
 * re-rendered the tree. A minute tick keeps it honest across the hour/day
 * threshold. The interval is deliberately coarse: the label's finest unit is a
 * minute, so a faster clock would only cost renders.
 */

const TICK_MS = 60_000;

/** "45s ago", "5m ago", "2h ago", "3d ago", or "Never". */
export function formatLastSeenAge(lastSeenAt: Date | null, now: number): string {
	const age = relativeAge(lastSeenAt, now);
	if (!age) return "Never";
	if (age.unit === "now") return `${elapsedParts(lastSeenAt, now)?.seconds ?? 0}s ago`;
	const suffix = age.unit === "minutes" ? "m" : age.unit === "hours" ? "h" : "d";
	return `${age.count}${suffix} ago`;
}

/** The current time, refreshed once a minute while the component is mounted. */
export function useElapsedNow(intervalMs: number = TICK_MS): number {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
		return () => window.clearInterval(timer);
	}, [intervalMs]);

	return now;
}

export function LastSeenValue({ at, className }: { at: Date | null; className?: string }) {
	const now = useElapsedNow();
	return (
		<span className={className} suppressHydrationWarning>
			{formatLastSeenAge(at, now)}
		</span>
	);
}
