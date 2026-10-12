"use client";

import { type NotificationPrefs, updateNotificationPrefs } from "@/lib/actions/settings";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface NotificationPrefsFormProps {
	pondId: string;
	initialPrefs: NotificationPrefs;
}

export function NotificationPrefsForm({ pondId, initialPrefs }: NotificationPrefsFormProps) {
	const t = useTranslations("dashboard.profileSettings");
	const [prefs, setPrefs] = useState<NotificationPrefs>(initialPrefs);
	const [isPending, startTransition] = useTransition();

	const handleChange = (key: keyof NotificationPrefs, value: boolean) => {
		const newPrefs = { ...prefs, [key]: value };
		setPrefs(newPrefs);

		startTransition(async () => {
			const result = await updateNotificationPrefs(pondId, newPrefs);
			if (result.success) {
				toast.success("Notification preferences saved");
			} else {
				toast.error(result.error || "Failed to save preferences");
				setPrefs(prefs); // revert on error
			}
		});
	};

	return (
		<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
			<div className="mb-6 border-b border-gray-100 pb-4">
				<h2 className="flex items-center gap-2 text-xl font-semibold text-gray-800">
					<Bell size={20} />
					{t("notifications")}
				</h2>
				<p className="mt-1 text-sm text-gray-500">{t("notificationsDesc")}</p>
			</div>

			<div className="space-y-4">
				<label className="flex items-center justify-between cursor-pointer">
					<div>
						<h3 className="font-medium text-gray-900">{t("missedFeedingAlerts")}</h3>
						<p className="text-sm text-gray-500">{t("missedFeedingAlertsDesc")}</p>
					</div>
					<div className="relative">
						<input
							type="checkbox"
							checked={prefs.missedFeeding}
							onChange={(e) => handleChange("missedFeeding", e.target.checked)}
							disabled={isPending}
							className="sr-only peer"
						/>
						<div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#1E7B34]" />
					</div>
				</label>
				<label className="flex items-center justify-between cursor-pointer">
					<div>
						<h3 className="font-medium text-gray-900">{t("deviceOfflineAlerts")}</h3>
						<p className="text-sm text-gray-500">{t("deviceOfflineAlertsDesc")}</p>
					</div>
					<div className="relative">
						<input
							type="checkbox"
							checked={prefs.deviceOffline}
							onChange={(e) => handleChange("deviceOffline", e.target.checked)}
							disabled={isPending}
							className="sr-only peer"
						/>
						<div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#1E7B34]" />
					</div>
				</label>
				<label className="flex items-center justify-between cursor-pointer">
					<div>
						<h3 className="font-medium text-gray-900">{t("hopperLowAlerts")}</h3>
						<p className="text-sm text-gray-500">{t("hopperLowAlertsDesc")}</p>
					</div>
					<div className="relative">
						<input
							type="checkbox"
							checked={prefs.hopperLow}
							onChange={(e) => handleChange("hopperLow", e.target.checked)}
							disabled={isPending}
							className="sr-only peer"
						/>
						<div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#1E7B34]" />
					</div>
				</label>
			</div>
		</section>
	);
}
