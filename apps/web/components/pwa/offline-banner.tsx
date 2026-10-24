"use client";

import { useOnlineStatus } from "@/lib/pwa/use-online-status";
import { WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";

export function OfflineBanner() {
	const t = useTranslations("pwa");
	const online = useOnlineStatus();

	if (online) return null;

	return (
		<output
			aria-live="polite"
			className="fixed inset-x-3 top-[4.5rem] z-40 mx-auto flex max-w-xl items-start gap-3 rounded-2xl border border-white/10 bg-[#0A3D62] px-4 py-3 text-white shadow-xl"
		>
			<WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-[#FFB38F]" aria-hidden="true" />
			<span className="min-w-0">
				<span className="block text-xs font-black uppercase tracking-[0.14em] text-white/60">
					{t("offlineTitle")}
				</span>
				<span className="mt-1 block text-sm font-medium leading-5 text-white/90">
					{t("offlineBody")}
				</span>
			</span>
		</output>
	);
}
