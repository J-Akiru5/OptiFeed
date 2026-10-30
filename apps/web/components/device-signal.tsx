"use client";

import { deviceSignalBars, isValidRssiDbm } from "@/lib/device-status";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

const BAR_HEIGHTS = ["h-1", "h-1.5", "h-2", "h-2.5"] as const;

/**
 * The reported Wi-Fi signal, rendered as four bars plus the reading in dBm
 * (issue #387/I-97). The number is always visible, so the strength never depends
 * on colour or on the icon alone; screen readers get the unit and the value.
 *
 * Renders nothing when no fresh reading exists (old firmware, stale heartbeat),
 * which keeps the timing-only surfaces unchanged.
 */
export function DeviceSignalReading({
	rssiDbm,
	className,
}: {
	rssiDbm: number | null;
	className?: string;
}) {
	const t = useTranslations("dashboard.common");
	if (!isValidRssiDbm(rssiDbm)) return null;

	const bars = deviceSignalBars(rssiDbm);

	return (
		<span className={cn("inline-flex items-center gap-1.5", className)}>
			<span aria-hidden="true" className="flex h-3 items-end gap-0.5">
				{BAR_HEIGHTS.map((height, index) => (
					<span
						// Bars are a fixed ladder: index 0 is the weakest.
						key={height}
						className={cn(
							"w-0.5 rounded-sm bg-current",
							height,
							index < bars ? "opacity-100" : "opacity-25",
						)}
					/>
				))}
			</span>
			<span className="sr-only">{t("signalLabel")}: </span>
			<span>{t("signalDbm", { dbm: rssiDbm })}</span>
		</span>
	);
}
