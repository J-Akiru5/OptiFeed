"use client";

import { formatFarmDateTime } from "@/lib/date-local";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/**
 * The raw ultrasonic distance beside the hopper calibration fields (#659).
 *
 * The firmware derives a percentage from the distance, and the dashboard only
 * ever rendered that percentage: `EnergyDevice.feedLevelCm` was ingested and
 * stored but no screen showed it, so an operator setting the full/empty
 * references had to measure the tank externally and could not watch the
 * reading move while a hand was under the sensor.
 *
 * The server stays the source of truth. The reading comes from the same
 * authenticated live endpoint the device viewer already polls
 * (`GET /api/devices/{id}/state`, tenant-scoped, `no-store`), and only while the
 * tab is visible and the form is mounted. A failed poll keeps the last value
 * instead of blanking a real reading. `readAction` is an injection seam for
 * tests and for a caller that already holds the reading.
 */

/** A poll every ~4 s is faster than the 5 s device heartbeat without flooding. */
export const HOPPER_DISTANCE_POLL_MS = 4_000;

export interface HopperDistanceSnapshot {
	/** Raw distance in cm, or null before the first heartbeat carrying one. */
	cm: number | null;
	/** The percentage the firmware derived from it, for cross-checking. */
	percent: number | null;
	/** ISO timestamp of the reading, or null when nothing arrived yet. */
	updatedAt: string | null;
}

export type HopperDistanceReader = (deviceId: string) => Promise<HopperDistanceSnapshot | null>;

/**
 * The raw distance from the device's live-state endpoint.
 *
 * `null` means "could not read" (network, 401/403, 404, malformed body): the
 * caller keeps the last value it had rather than reporting an empty hopper.
 */
export async function fetchHopperDistance(
	deviceId: string,
): Promise<HopperDistanceSnapshot | null> {
	try {
		const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/state`, {
			headers: { accept: "application/json" },
			cache: "no-store",
		});
		if (!response.ok) return null;
		const body = (await response.json()) as {
			data?: {
				feedLevelCm?: number | null;
				feedLevelPercent?: number | null;
				feedLevelUpdatedAt?: string | null;
			};
		};
		if (!body.data) return null;
		return {
			cm: body.data.feedLevelCm ?? null,
			percent: body.data.feedLevelPercent ?? null,
			updatedAt: body.data.feedLevelUpdatedAt ?? null,
		};
	} catch {
		return null;
	}
}

interface HopperLiveDistanceProps {
	deviceId: string;
	initial: HopperDistanceSnapshot;
	/** Override the endpoint read (tests, or a caller that already has it). */
	readAction?: HopperDistanceReader;
	/** The unit or its sensor is not answering, so the value is last-known. */
	isStale?: boolean;
	/** False for a read-only member; the capture buttons are then disabled. */
	canWrite?: boolean;
	/** Fill the full/empty field with the current reading. */
	onCapture?: (target: "full" | "empty", cm: number) => void;
	intervalMs?: number;
}

export function HopperLiveDistance({
	deviceId,
	initial,
	readAction,
	isStale = false,
	canWrite = true,
	onCapture,
	intervalMs = HOPPER_DISTANCE_POLL_MS,
}: HopperLiveDistanceProps) {
	const t = useTranslations("dashboard.appSettings");
	const tDates = useTranslations("dates");
	const locale = useLocale();
	const [reading, setReading] = useState<HopperDistanceSnapshot>(initial);
	const [visible, setVisible] = useState(false);
	const hostRef = useRef<HTMLDivElement | null>(null);
	const inFlight = useRef(false);

	useEffect(() => {
		setReading(initial);
	}, [initial]);

	// Only poll while this block is actually on screen. The device settings page
	// keeps every tab panel mounted and merely hides the inactive ones, so a
	// mount-only effect would poll from every tab (and from far down this one).
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return undefined;
		if (typeof IntersectionObserver === "undefined") {
			setVisible(true);
			return undefined;
		}
		const observer = new IntersectionObserver((entries) => {
			setVisible(entries.some((entry) => entry.isIntersecting));
		});
		observer.observe(host);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!visible) return undefined;
		const read = readAction ?? fetchHopperDistance;

		const poll = async () => {
			if (document.visibilityState !== "visible") return;
			if (inFlight.current) return;
			inFlight.current = true;
			try {
				const next = await read(deviceId);
				// `null` means the read failed or the device is gone: keep the last
				// value rather than pretending there is no reading.
				if (next) setReading(next);
			} finally {
				inFlight.current = false;
			}
		};

		// A fresh value as soon as the block comes back into view, then on the
		// interval.
		void poll();
		const timer = window.setInterval(() => {
			void poll();
		}, intervalMs);
		const onVisible = () => {
			if (document.visibilityState === "visible") void poll();
		};
		document.addEventListener("visibilitychange", onVisible);

		return () => {
			window.clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [deviceId, intervalMs, readAction, visible]);

	const cm = reading.cm;
	const formattedCm =
		cm === null
			? "—"
			: new Intl.NumberFormat(locale, {
					minimumFractionDigits: 1,
					maximumFractionDigits: 1,
				}).format(cm);
	const readingAt = reading.updatedAt ? new Date(reading.updatedAt) : null;
	const readingTime =
		readingAt && Number.isFinite(readingAt.getTime())
			? formatFarmDateTime(readingAt, tDates)
			: null;
	const canCapture = canWrite && cm !== null && !isStale;

	return (
		<div
			ref={hostRef}
			className="rounded-xl border border-[#0A3D62]/10 bg-[#F4F7F6] p-3 dark:border-gray-700 dark:bg-gray-800/60"
			data-testid="hopper-live-distance"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-300">
					{t("hopperRawDistance")}
				</p>
				<p className="text-lg font-extrabold tabular-nums text-[#0A3D62] dark:text-gray-100">
					<span data-testid="hopper-raw-cm">{formattedCm}</span>{" "}
					<span className="text-xs font-bold text-[#3D5568] dark:text-gray-300">cm</span>
				</p>
			</div>
			<p className="mt-1 text-[11px] leading-tight text-[#3D5568] dark:text-gray-400">
				{reading.cm === null
					? t("hopperRawDistanceNone")
					: readingTime
						? t("hopperRawDistanceAt", { date: readingTime.date, time: readingTime.time })
						: t("hopperRawDistanceUnknownTime")}
				{isStale && reading.cm !== null && (
					<span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#3D5568] dark:bg-gray-800 dark:text-gray-300">
						{t("hopperRawDistanceLastKnown")}
					</span>
				)}
			</p>
			<p className="mt-1 text-[11px] leading-tight text-[#3D5568] dark:text-gray-400">
				{t("hopperRawDistanceHint")}
			</p>

			<div className="mt-2 flex flex-wrap gap-2">
				<button
					type="button"
					onClick={() => {
						if (canCapture) onCapture?.("full", cm);
					}}
					disabled={!canCapture}
					className={cn(
						"min-h-9 rounded-lg border border-[#0A3D62]/20 px-3 text-xs font-bold text-[#0A3D62]",
						"disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200",
					)}
				>
					{t("hopperRawCaptureFull")}
				</button>
				<button
					type="button"
					onClick={() => {
						if (canCapture) onCapture?.("empty", cm);
					}}
					disabled={!canCapture}
					className={cn(
						"min-h-9 rounded-lg border border-[#0A3D62]/20 px-3 text-xs font-bold text-[#0A3D62]",
						"disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200",
					)}
				>
					{t("hopperRawCaptureEmpty")}
				</button>
			</div>
		</div>
	);
}
