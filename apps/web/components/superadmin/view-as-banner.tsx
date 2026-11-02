"use client";

import { FOCUS_RING } from "@/components/superadmin/ui";
import { useRouter } from "@/i18n/routing";
import { stopViewAs } from "@/lib/actions/platform/impersonation";
import { formatDateTimeLocal } from "@/lib/date-local";
import { cn } from "@/lib/utils";
import { Eye, Loader2, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

/**
 * Red read-only banner for a view-as session (plan M5.1).
 *
 * It is rendered by the tenant dashboard layout whenever a live session exists.
 * Leaving is always allowed and needs no step-up: the exit button ends the row,
 * audits the stop and clears the signed cookie.
 */
export function ViewAsBanner({
	orgName,
	reason,
	expiresAt,
}: {
	orgName: string;
	reason: string;
	expiresAt: string;
}) {
	const t = useTranslations("superadmin.viewAsBanner");
	const router = useRouter();
	const tDates = useTranslations("dates");
	const [isPending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [localExpiry, setLocalExpiry] = useState<string | null>(null);

	// Format on the client only, so the server's timezone cannot cause a
	// hydration mismatch.
	useEffect(() => {
		setLocalExpiry(formatDateTimeLocal(new Date(expiresAt), tDates).time);
	}, [expiresAt, tDates]);

	const exit = () => {
		setError(null);
		startTransition(async () => {
			try {
				const result = await stopViewAs();
				if ("error" in result) {
					setError(result.error);
					return;
				}
				router.push("/superadmin/orgs");
				router.refresh();
			} catch (err) {
				setError(err instanceof Error ? err.message : t("exitFailed"));
			}
		});
	};

	return (
		<div aria-live="polite" className="w-full bg-[#C42B3A] px-4 py-3 text-white shadow-md md:px-8">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-start gap-2.5">
					<Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
					<div className="min-w-0 text-xs md:text-sm">
						<p className="font-black uppercase tracking-wide">{t("title", { orgName })}</p>
						<p className="mt-0.5 break-words text-white/90">
							{t("reason", { reason })}
							{localExpiry ? t("endsAt", { time: localExpiry }) : ""}
						</p>
						<p className="mt-0.5 text-[11px] text-white/85">{t("note")}</p>
					</div>
				</div>
				<div className="flex items-center gap-3">
					{error && (
						<span role="alert" className="text-[11px] font-bold text-white">
							{error}
						</span>
					)}
					<button
						type="button"
						onClick={exit}
						disabled={isPending}
						className={cn(
							"inline-flex items-center gap-1.5 rounded-xl bg-white dark:bg-[#111A2C] px-3 py-2 text-xs font-black text-[#C42B3A] dark:text-red-300 hover:bg-white/90 disabled:opacity-60",
							FOCUS_RING,
							"focus-visible:ring-white focus-visible:ring-offset-[#C42B3A]",
						)}
					>
						{isPending ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
						) : (
							<LogOut className="h-3.5 w-3.5" aria-hidden="true" />
						)}
						{t("exit")}
					</button>
				</div>
			</div>
		</div>
	);
}
