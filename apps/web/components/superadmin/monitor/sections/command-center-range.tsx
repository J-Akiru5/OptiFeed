"use client";

import type { ChartRange, ChartRangeKey } from "@/components/charts/chart-range";
import { ChartRangeProvider } from "@/components/charts/chart-range";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useState } from "react";

/**
 * The command center's controlled chart range (#707).
 *
 * `ChartRangeControl` on its own only filters the rows the server already sent,
 * which would leave the queries running on the old window. This frame lifts the
 * range out of the provider and writes the preset into `?range=`, so choosing
 * 7, 30 or 90 re-runs every read model behind the page.
 *
 * A custom window has no server spelling — `parseAnalyticsRange` accepts only
 * the three presets — so it keeps the widest window loaded (90 days) and lets
 * the charts narrow it locally. That is why a custom pick navigates once, to
 * `?range=90`, and then stays client-side.
 *
 * The preset follows the URL prop, so Back and Forward move the control with the
 * data. A click also selects its preset immediately instead of waiting for the
 * server round trip; that optimistic value is dropped as soon as the new prop
 * arrives. Only the custom window is local state.
 */

const PRESET_DAYS: Record<Exclude<ChartRangeKey, "custom">, number> = {
	"7d": 7,
	"30d": 30,
	"90d": 90,
};

const DEFAULT_WINDOW_DAYS = PRESET_DAYS["90d"];

export function CommandCenterRangeFrame({
	initialKey,
	anchor,
	children,
}: {
	/** The preset the current server render used (`?range=`). */
	initialKey: Exclude<ChartRangeKey, "custom">;
	/** Noon of the newest bucket the read models returned; see `rangeAnchor`. */
	anchor?: Date;
	children: ReactNode;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const [custom, setCustom] = useState<{ from: Date; to: Date } | null>(null);
	// A click selects its preset before the server answers. The pair remembers
	// which URL value it was chosen against, so it stops applying as soon as the
	// prop arrives (or the reader navigates) and the URL takes over again.
	const [pending, setPending] = useState<{
		key: Exclude<ChartRangeKey, "custom">;
		against: Exclude<ChartRangeKey, "custom">;
	} | null>(null);

	const preset = pending && pending.against === initialKey ? pending.key : initialKey;
	const range: ChartRange = custom
		? { key: "custom", from: custom.from, to: custom.to }
		: { key: preset, from: null, to: null };

	const replaceRange = useCallback(
		(days: number) => {
			router.replace(`${pathname}?range=${days}`, { scroll: false });
		},
		[pathname, router],
	);

	const change = useCallback(
		(next: ChartRange) => {
			if (next.key === "custom") {
				const to = next.to ?? new Date();
				const from =
					next.from ?? new Date(to.getTime() - (DEFAULT_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);
				setCustom({ from, to });
				setPending(null);
				if (PRESET_DAYS[initialKey] !== DEFAULT_WINDOW_DAYS) {
					replaceRange(DEFAULT_WINDOW_DAYS);
				}
				return;
			}

			setCustom(null);
			setPending(next.key === initialKey ? null : { key: next.key, against: initialKey });
			if (next.key !== initialKey) replaceRange(PRESET_DAYS[next.key]);
		},
		[initialKey, replaceRange],
	);

	return (
		<ChartRangeProvider value={range} onChange={change} now={anchor}>
			{children}
		</ChartRangeProvider>
	);
}
