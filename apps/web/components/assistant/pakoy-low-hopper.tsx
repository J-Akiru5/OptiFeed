"use client";

import { MessageCircle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ASSISTANT_NAME, Mascot } from "./mascot";

const DISMISS_PREFIX = "optifeed:pakoy-low-hopper:v1:";

interface PakoyLowHopperProps {
	/** Stable pond id, so one pond's dismissal does not silence another's. */
	pondId: string;
	/** Latest hopper reading, already rounded for display. */
	levelPercent: number;
	/** Server-side decision: the org threshold says this level is low. */
	low: boolean;
	className?: string;
}

/**
 * The low-hopper reminder from the placement guide (#221): Pakoy warns once a
 * farm day per pond, the farmer presses "Got it", and the bell keeps the
 * permanent record. Presentation only; the alert itself is created by ingest.
 */
export function PakoyLowHopper({ pondId, levelPercent, low, className }: PakoyLowHopperProps) {
	const t = useTranslations("dashboard.home");
	const [visible, setVisible] = useState(false);
	const storageKey = `${DISMISS_PREFIX}${pondId}:${todayKey()}`;

	useEffect(() => {
		if (!low) return;
		try {
			if (localStorage.getItem(storageKey) === "true") return;
		} catch {
			// Storage unavailable: still show the reminder once per mount.
		}
		setVisible(true);
	}, [low, storageKey]);

	if (!low || !visible) return null;

	const dismiss = () => {
		setVisible(false);
		try {
			localStorage.setItem(storageKey, "true");
		} catch {
			// Dismissal lasts for this view only.
		}
	};

	return (
		<output
			aria-live="polite"
			data-testid="pakoy-low-hopper"
			className={`block fixed right-[var(--ofd-fab-inset)] bottom-[calc(var(--ofd-fab-anchor)+8.5rem)] z-30 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-amber-200 bg-white p-3 shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 dark:border-amber-900/50 dark:bg-gray-900 ${className ?? ""}`}
		>
			<div className="flex items-start gap-2">
				<Mascot pose="lowHopper" size={56} className="shrink-0" />
				<div className="min-w-0 flex-1">
					<p className="text-[10px] font-black uppercase tracking-wider text-[#A86400] dark:text-amber-300">
						{ASSISTANT_NAME}
					</p>
					<p className="mt-0.5 text-sm font-black leading-snug text-[#0A3D62] dark:text-gray-100">
						{t("lowHopperPopupTitle", { percent: levelPercent })}
					</p>
					<p className="mt-0.5 text-xs font-semibold leading-snug text-[#3D5568] dark:text-gray-300">
						{t("lowHopperPopupBody")}
					</p>
					<button
						type="button"
						onClick={dismiss}
						className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#0A3D62] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#12588c] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:bg-[#1f66a0] dark:focus-visible:outline-[#8fc0ea]"
					>
						<MessageCircle aria-hidden="true" className="h-3.5 w-3.5" />
						{t("lowHopperPopupGotIt")}
					</button>
				</div>
				<button
					type="button"
					onClick={dismiss}
					aria-label={t("lowHopperPopupDismiss")}
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#3D5568] transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:text-gray-400 dark:hover:bg-gray-800 dark:focus-visible:ring-[#8fc0ea]"
				>
					<X aria-hidden="true" className="h-4 w-4" />
				</button>
			</div>
		</output>
	);
}

/** Local calendar day: the reminder may return tomorrow, not on every render. */
function todayKey(): string {
	const now = new Date();
	return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}
