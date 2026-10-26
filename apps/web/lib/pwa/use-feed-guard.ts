"use client";

import { useOnlineStatus } from "@/lib/pwa/use-online-status";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";

/**
 * Shared browser-offline guard for feeder controls. Every handler calls
 * `blockIfOffline()` first, so a feed/pause/resume is refused with a visible
 * reason instead of failing silently (and never queued for later).
 */
export function useFeedCommandGuard() {
	const online = useOnlineStatus();
	const t = useTranslations("pwa");
	const reason = online ? undefined : t("feedBlockedOffline");

	const blockIfOffline = useCallback(() => {
		if (online) return false;
		toast.error(t("feedBlockedOffline"));
		return true;
	}, [online, t]);

	return { online, reason, blockIfOffline };
}
