"use client";

import { flushBiomassOutbox } from "@/lib/offline/sync";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

export function OfflineSync({ scope }: { scope: string }) {
	const t = useTranslations("pwa");
	const running = useRef(false);

	const run = useCallback(async () => {
		if (running.current) return;
		if (typeof navigator !== "undefined" && !navigator.onLine) return;
		running.current = true;
		try {
			const result = await flushBiomassOutbox(scope);
			if (result.synced > 0) {
				toast.success(t("syncSuccess", { count: result.synced }));
			}
			if (result.errors.length > 0 && result.remaining > 0) {
				toast.error(t("syncPending", { count: result.remaining }));
			}
		} finally {
			running.current = false;
		}
	}, [scope, t]);

	useEffect(() => {
		void run();
		const onOnline = () => void run();
		window.addEventListener("online", onOnline);
		return () => window.removeEventListener("online", onOnline);
	}, [run]);

	return null;
}
