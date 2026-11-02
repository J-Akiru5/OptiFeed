"use client";

import { FOCUS_RING } from "@/components/superadmin/ui";
import { cn } from "@/lib/utils";
import { Check, Copy, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * A freshly issued device token, shown once.
 *
 * It lives in client state only (never the URL, storage or a server-rendered
 * payload) and is dropped when the admin confirms it has been set on the unit.
 */
export function DeviceTokenOnce({
	token,
	mac,
	onDone,
}: {
	token: string;
	mac: string;
	onDone: () => void;
}) {
	const t = useTranslations("superadmin.tokenOnce");
	const tCommon = useTranslations("superadmin.common");
	const [copied, setCopied] = useState(false);
	const [copyFailed, setCopyFailed] = useState(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(token);
			setCopied(true);
			setCopyFailed(false);
		} catch {
			// Clipboard is blocked outside a secure context; the token stays on
			// screen so it can be copied by hand.
			setCopyFailed(true);
		}
	};

	return (
		<div className="space-y-3 rounded-xl border border-[#F5B87A] bg-[#FFF4E8] p-4 dark:border-amber-500/40 dark:bg-amber-950/50">
			<p className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[#8A4A00] dark:text-amber-300">
				<KeyRound className="h-4 w-4" aria-hidden="true" />
				{t("title", { mac })}
			</p>
			<code className="block break-all rounded-lg border border-[#F5B87A] bg-white dark:bg-[#111A2C] px-3 py-2 font-mono text-xs font-bold text-[#0A3D62] dark:text-slate-100">
				{token}
			</code>
			<p className="text-[11px] leading-snug text-[#3D5568] dark:text-slate-400">
				{t("hintBefore")}
				<b>{t("deviceToken")}</b>
				{t("hintMiddle")}
				<b>{t("deviceId")}</b>
				{t("hintAfter")}
			</p>
			{copyFailed && (
				<p role="alert" className="text-[11px] font-bold text-[#C42B3A] dark:text-red-300">
					{t("copyFailed")}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					onClick={copy}
					className={cn(
						"inline-flex items-center gap-1.5 rounded-lg border border-[#0A3D62]/20 bg-white dark:bg-[#111A2C] px-3 py-1.5 text-xs font-black text-[#0A3D62] dark:text-slate-100 hover:bg-[#F4F7F6] dark:hover:bg-[#162238]",
						FOCUS_RING,
					)}
				>
					{copied ? (
						<Check className="h-3.5 w-3.5" aria-hidden="true" />
					) : (
						<Copy className="h-3.5 w-3.5" aria-hidden="true" />
					)}
					{copied ? tCommon("copied") : t("copy")}
				</button>
				<button
					type="button"
					onClick={onDone}
					className={cn(
						"inline-flex items-center gap-1.5 rounded-lg bg-[#0A3D62] px-3 py-1.5 text-xs font-black text-white hover:bg-[#082f4d]",
						FOCUS_RING,
					)}
				>
					{t("done")}
				</button>
			</div>
		</div>
	);
}
