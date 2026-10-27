"use client";

import type { AnnouncementSeverity } from "@/lib/announcement";
import { cn } from "@/lib/utils";
import { AlertTriangle, Info, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/**
 * Platform announcement banner (E16.4, task I-15).
 *
 * Rendered by the tenant layouts from the active `announcement.current`
 * setting. Dismissal is remembered per user and per announcement in
 * `localStorage`, wrapped in try/catch: private mode or a quota error hides
 * nothing permanently and never breaks the page.
 */

const STORAGE_PREFIX = "ofd:announcement-dismissed:";

export function announcementStorageKey(id: string): string {
	return `${STORAGE_PREFIX}${id}`;
}

export function readAnnouncementDismissed(id: string): boolean {
	if (typeof window === "undefined") return false;
	try {
		return window.localStorage.getItem(announcementStorageKey(id)) === "1";
	} catch {
		return false;
	}
}

export function storeAnnouncementDismissed(id: string): void {
	try {
		window.localStorage.setItem(announcementStorageKey(id), "1");
	} catch {
		// Storage unavailable: the banner still hides for this visit.
	}
}

export function AnnouncementBanner({
	id,
	title,
	body,
	severity,
}: {
	id: string;
	title: string;
	body: string;
	severity: AnnouncementSeverity;
}) {
	const t = useTranslations("announcements");
	const [visible, setVisible] = useState(false);

	// Resolve after mount so the server render and hydration agree.
	useEffect(() => {
		setVisible(!readAnnouncementDismissed(id));
	}, [id]);

	if (!visible) return null;

	const warning = severity === "warning";
	const Icon = warning ? AlertTriangle : Info;

	return (
		<aside
			aria-label={t("label")}
			className={cn(
				"relative flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-sm",
				warning
					? "border-[#F0C36D] bg-[#FFF7E6] text-[#7A4B00]"
					: "border-[#9CC3E0] bg-[#EDF6FC] text-[#0A3D62] dark:border-[#2C4B66] dark:bg-[#10263A] dark:text-[#CFE4F5]",
			)}
		>
			<Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
			<div className="min-w-0 flex-1">
				<p className="text-[10px] font-black tracking-wider uppercase opacity-80">
					{warning ? t("severity.warning") : t("severity.info")}
				</p>
				<p className="font-black">{title}</p>
				<p className="mt-0.5 whitespace-pre-line">{body}</p>
			</div>
			<button
				type="button"
				onClick={() => {
					storeAnnouncementDismissed(id);
					setVisible(false);
				}}
				aria-label={t("dismiss")}
				className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
			>
				<X className="h-4 w-4" aria-hidden="true" />
			</button>
		</aside>
	);
}
