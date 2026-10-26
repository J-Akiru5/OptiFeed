"use client";

import { formatDateTimeLocal } from "@/lib/date-local";
import { clearOfflineDataIfUserChanged, getOfflineMeta } from "@/lib/offline/db";
import {
	OUTBOX_CHANGED_EVENT,
	listOutbox,
	removeOutboxItem,
	resetOutboxItem,
} from "@/lib/offline/outbox";
import { flushBiomassOutbox } from "@/lib/offline/sync";
import { useOnlineStatus } from "@/lib/pwa/use-online-status";
import { createClient } from "@/lib/supabase/client";
import { AlertTriangle, CloudOff, RefreshCw, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface FailedItem {
	id: string;
	createdAt: string;
	error: string;
	status: "failed" | "conflict";
}

interface QueueSummary {
	pending: number;
	failed: number;
	conflicts: number;
	items: FailedItem[];
	lastSyncedAt: string | null;
}

const EMPTY_SUMMARY: QueueSummary = {
	pending: 0,
	failed: 0,
	conflicts: 0,
	items: [],
	lastSyncedAt: null,
};

/**
 * Replays the offline outbox and shows its state: pending count, a retry
 * control and any failed/conflicted item with retry/discard actions. Nothing
 * is ever dropped silently.
 */
export function OfflineSync({ scope }: { scope: string }) {
	const t = useTranslations("pwa");
	const tDates = useTranslations("dates");
	const online = useOnlineStatus();
	const running = useRef(false);
	const identityResolved = useRef(false);
	const [busy, setBusy] = useState(false);
	const [summary, setSummary] = useState<QueueSummary>(EMPTY_SUMMARY);
	const [dismissed, setDismissed] = useState(false);

	const refresh = useCallback(async () => {
		try {
			const [items, meta] = await Promise.all([listOutbox(), getOfflineMeta()]);
			const scoped = items.filter((item) => item.payload.scope === scope);
			setSummary({
				pending: scoped.filter((item) => item.status === "pending").length,
				failed: scoped.filter((item) => item.status === "failed").length,
				conflicts: scoped.filter((item) => item.status === "conflict").length,
				items: scoped
					.filter((item) => item.status === "failed" || item.status === "conflict")
					.map((item) => ({
						id: item.id,
						createdAt: item.createdAt,
						error: item.lastError ?? t("syncUnknownError"),
						status: item.status as "failed" | "conflict",
					})),
				lastSyncedAt: meta?.savedAt ?? null,
			});
		} catch {
			// Storage unavailable: keep the last known summary.
		}
	}, [scope, t]);

	const run = useCallback(async () => {
		if (running.current) return;
		// The mount effect resolves identity first; an early event cannot flush
		// with the wrong account's queue.
		if (!identityResolved.current) return;
		if (typeof navigator !== "undefined" && !navigator.onLine) {
			await refresh();
			return;
		}
		running.current = true;
		setBusy(true);
		try {
			const result = await flushBiomassOutbox(scope);
			if (result.discardedFeed > 0) {
				toast.warning(t("feedDiscarded", { count: result.discardedFeed }));
			}
			if (result.synced > 0) {
				toast.success(t("syncSuccess", { count: result.synced }));
			}
			if (result.errors.length > 0 && result.remaining > 0) {
				toast.error(t("syncPending", { count: result.remaining }));
			}
			await refresh();
		} finally {
			running.current = false;
			setBusy(false);
		}
	}, [scope, t, refresh]);

	// A different signed-in account must not inherit this device's offline queue.
	// Identity is resolved before the first replay so a new user can never flush
	// the previous user's queued samples with their own session.
	useEffect(() => {
		let cancelled = false;

		const syncIdentity = async () => {
			try {
				// getSession reads the local session without a network round trip, so
				// identity is known immediately even when the device is offline.
				const {
					data: { session },
				} = await createClient().auth.getSession();
				const user = session?.user;
				if (!user || cancelled) return;
				const cleared = await clearOfflineDataIfUserChanged(user.id);
				if (!cancelled && cleared) toast.info(t("clearedForNewUser"));
			} catch {
				// Identity refresh is best-effort; sign-out paths also clear the store.
			}
		};

		const start = async () => {
			await syncIdentity();
			identityResolved.current = true;
			if (!cancelled) await run();
		};

		void start();
		const onOnline = () => void run();
		const onOutboxChanged = () => void refresh();
		window.addEventListener("online", onOnline);
		window.addEventListener(OUTBOX_CHANGED_EVENT, onOutboxChanged);
		return () => {
			cancelled = true;
			window.removeEventListener("online", onOnline);
			window.removeEventListener(OUTBOX_CHANGED_EVENT, onOutboxChanged);
		};
	}, [run, refresh, t]);

	const retryItem = async (id: string) => {
		await resetOutboxItem(id);
		await run();
	};

	const discardItem = async (id: string) => {
		await removeOutboxItem(id);
		toast.info(t("itemDiscarded"));
		await refresh();
	};

	// A newly queued sample re-opens a panel the user dismissed earlier.
	const previousPending = useRef(0);
	useEffect(() => {
		if (summary.pending > previousPending.current) setDismissed(false);
		previousPending.current = summary.pending;
	}, [summary.pending]);

	const pending = summary.pending + summary.failed + summary.conflicts;
	const hasIssues = summary.items.length > 0;
	const visible = pending > 0 || hasIssues;
	if (!visible) return null;
	if (dismissed && !hasIssues) return null;

	let lastSynced: string | null = null;
	if (summary.lastSyncedAt) {
		const date = new Date(summary.lastSyncedAt);
		if (!Number.isNaN(date.getTime())) {
			lastSynced = formatDateTimeLocal(date, tDates).full;
		}
	}

	return (
		<section
			aria-live="polite"
			aria-label={t("syncPanelLabel")}
			className="fixed inset-x-3 bottom-24 z-40 mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-4 text-[#0A3D62] shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 sm:bottom-6 sm:right-4 sm:left-auto sm:mx-0"
		>
			<div className="flex items-start gap-3">
				<CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-[#E85A2A]" aria-hidden="true" />
				<div className="min-w-0 flex-1">
					<p className="text-sm font-black">{t("pendingTitle", { count: pending })}</p>
					<p className="mt-1 text-xs font-medium text-[#3D5568] dark:text-gray-400">
						{online ? t("pendingBody") : t("waitingForConnection")}
					</p>
					{lastSynced && (
						<p className="mt-1 text-[11px] font-semibold text-[#3D5568] dark:text-gray-400">
							{t("lastSynced", { time: lastSynced })}
						</p>
					)}
				</div>
				{!hasIssues && (
					<button
						type="button"
						onClick={() => setDismissed(true)}
						aria-label={t("dismiss")}
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-[#3D5568] transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
					>
						<X className="h-4 w-4" aria-hidden="true" />
					</button>
				)}
			</div>

			{summary.pending > 0 && (
				<button
					type="button"
					onClick={() => void run()}
					disabled={!online || busy}
					title={!online ? t("retryBlockedOffline") : undefined}
					className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#E85A2A] px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-[#d04a1f] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 dark:disabled:bg-gray-700 dark:disabled:text-gray-300"
				>
					<RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
					{busy ? t("syncing") : t("retrySync")}
				</button>
			)}

			{hasIssues && (
				<ul className="mt-3 space-y-2">
					{summary.items.map((item) => {
						const created = new Date(item.createdAt);
						const createdLabel = Number.isNaN(created.getTime())
							? ""
							: formatDateTimeLocal(created, tDates).full;
						return (
							<li
								key={item.id}
								className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-950/30"
							>
								<div className="flex items-start gap-2">
									<AlertTriangle
										className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
										aria-hidden="true"
									/>
									<div className="min-w-0 flex-1">
										<p className="font-black text-amber-900 dark:text-amber-200">
											{item.status === "conflict" ? t("conflictLabel") : t("failedLabel")}
											{createdLabel && (
												<span className="font-semibold text-amber-800/80 dark:text-amber-300/80">
													{" "}
													· {createdLabel}
												</span>
											)}
										</p>
										<p className="mt-1 font-medium text-amber-900 dark:text-amber-200">
											{t("itemError", { message: item.error })}
										</p>
									</div>
								</div>
								<div className="mt-2 flex gap-2">
									<button
										type="button"
										onClick={() => void retryItem(item.id)}
										disabled={!online || busy}
										className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-black text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-gray-900 dark:text-amber-200"
									>
										{t("retryItem")}
									</button>
									<button
										type="button"
										onClick={() => void discardItem(item.id)}
										className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-black text-[#3D5568] transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
									>
										<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
										{t("discardItem")}
									</button>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
