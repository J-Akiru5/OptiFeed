"use client";

import { DashboardSection } from "@/components/dashboard/dashboard-ui";
import { updateNotificationPrefs } from "@/lib/actions/notifications";
import { type NotificationPrefs, normalizeNotificationPrefs } from "@/lib/limits";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface NotificationPrefsFormProps {
	pondId: string;
	initialPrefs: unknown;
	canWrite?: boolean;
}

type Feedback = { kind: "success" | "error"; message: string } | null;

export function NotificationPrefsForm({
	pondId,
	initialPrefs,
	canWrite = true,
}: NotificationPrefsFormProps) {
	const t = useTranslations("dashboard.profileSettings");
	// Legacy rows may only contain the feeding/device flags. Normalize before
	// render so the new toggles start checked instead of undefined.
	const [prefs, setPrefs] = useState<NotificationPrefs>(() =>
		normalizeNotificationPrefs(initialPrefs),
	);
	const [feedback, setFeedback] = useState<Feedback>(null);
	const [isPending, startTransition] = useTransition();

	const handleChange = (key: keyof NotificationPrefs, value: boolean) => {
		const previous = prefs;
		const newPrefs = { ...prefs, [key]: value };
		setPrefs(newPrefs);
		setFeedback(null);

		startTransition(async () => {
			const result = await updateNotificationPrefs(pondId, newPrefs);
			if (result.success) {
				const message = t("notificationsSaved");
				setFeedback({ kind: "success", message });
				toast.success(message);
			} else {
				const message = result.error || t("notificationsSaveError");
				setFeedback({ kind: "error", message });
				toast.error(message);
				setPrefs(previous); // revert on error
			}
		});
	};

	const toggles: { key: keyof NotificationPrefs; label: string; description: string }[] = [
		{
			key: "missedFeeding",
			label: t("missedFeedingAlerts"),
			description: t("missedFeedingAlertsDesc"),
		},
		{
			key: "deviceOffline",
			label: t("deviceOfflineAlerts"),
			description: t("deviceOfflineAlertsDesc"),
		},
		{ key: "hopperLow", label: t("hopperLowAlerts"), description: t("hopperLowAlertsDesc") },
		{
			key: "harvestReminders",
			label: t("harvestReminders"),
			description: t("harvestRemindersDesc"),
		},
		{
			key: "samplingReminders",
			label: t("samplingReminders"),
			description: t("samplingRemindersDesc"),
		},
		{ key: "emailReminders", label: t("emailReminders"), description: t("emailRemindersDesc") },
	];

	return (
		<DashboardSection title={t("notifications")} description={t("notificationsDesc")} icon={Bell}>
			<div className="space-y-1">
				{toggles.map((toggle) => (
					<label
						key={toggle.key}
						className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-xl px-1 py-3 transition-colors hover:bg-[#F4F7F6] dark:hover:bg-gray-800/60"
					>
						<span className="min-w-0">
							<span className="block text-sm font-bold text-[#0A3D62] dark:text-gray-100">
								{toggle.label}
							</span>
							<span className="block text-xs text-[#3D5568] dark:text-gray-400">
								{toggle.description}
							</span>
						</span>
						<span className="relative shrink-0">
							<input
								type="checkbox"
								checked={prefs[toggle.key]}
								onChange={(e) => handleChange(toggle.key, e.target.checked)}
								disabled={isPending || !canWrite}
								className="peer sr-only"
							/>
							<span className="block h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-[#1E7B34] peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-[#0A3D62] peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 dark:bg-gray-600 dark:peer-focus-visible:ring-[#8fc0ea] dark:peer-focus-visible:ring-offset-gray-900" />
							<span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full border border-gray-300 bg-white transition-transform peer-checked:translate-x-5 dark:border-gray-500" />
						</span>
					</label>
				))}
			</div>

			{feedback && (
				<p
					role={feedback.kind === "error" ? "alert" : "status"}
					className={
						feedback.kind === "error"
							? "mt-3 text-sm font-bold text-[#C42B3A] dark:text-red-300"
							: "mt-3 text-sm font-bold text-[#1E7B34] dark:text-green-300"
					}
				>
					{feedback.message}
				</p>
			)}
		</DashboardSection>
	);
}
