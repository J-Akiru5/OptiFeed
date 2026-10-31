"use client";

import { useOnlineStatus } from "@/lib/pwa/use-online-status";
import { WifiOff, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/**
 * Quiet offline indicator (#381).
 *
 * It used to be a large, undismissable card pinned under the header, which read
 * like an error toast that could not be closed. Offline is a normal state for a
 * farmer on a weak connection, not a failure, so this is a small pill the reader
 * can dismiss. Dismissing hides it for that offline period only: when the
 * connection comes back and drops again, the pill returns, so a stale dismissal
 * cannot hide a new outage.
 */
export function OfflineBanner() {
	const t = useTranslations("pwa");
	const online = useOnlineStatus();
	const [dismissed, setDismissed] = useState(false);

	useEffect(() => {
		if (online) setDismissed(false);
	}, [online]);

	if (online || dismissed) return null;

	return (
		<output
			aria-live="polite"
			aria-atomic="true"
			data-testid="offline-banner"
			title={t("offlineControlsHint")}
			className="fixed bottom-20 left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-[#0A3D62]/95 px-3 py-1.5 text-white shadow-lg backdrop-blur sm:bottom-4"
		>
			<WifiOff className="h-3.5 w-3.5 shrink-0 text-[#FFB38F]" aria-hidden="true" />
			<span className="min-w-0 truncate text-xs font-semibold">{t("offlineTitle")}</span>
			<span className="hidden min-w-0 truncate text-xs text-white/70 sm:inline">
				{t("offlineBody")}
			</span>
			<button
				type="button"
				onClick={() => setDismissed(true)}
				aria-label={t("dismiss")}
				className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
			>
				<X className="h-3.5 w-3.5" aria-hidden="true" />
			</button>
		</output>
	);
}
