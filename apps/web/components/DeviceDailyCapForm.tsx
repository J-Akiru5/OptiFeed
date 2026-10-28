"use client";

import {
	dashboardButtonPrimary,
	dashboardField,
	dashboardHint,
	dashboardLabel,
} from "@/components/dashboard/dashboard-classes";
import {
	DAILY_CAP_MIN_G,
	DEFAULT_DAILY_CAP_G,
	MAX_FEED_GRAMS_PER_DAY_PER_DEVICE,
} from "@/lib/limits";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type SaveAction = (
	deviceId: string,
	dailyCapG: number,
) => Promise<{ success: boolean; error?: string; dailyCapG?: number }>;

interface DeviceDailyCapFormProps {
	deviceId: string;
	/** Stored ceiling; null means the 2,000 g default applies. */
	currentCapG: number | null;
	saveAction: SaveAction;
	canWrite?: boolean;
}

/**
 * The farmer- and admin-editable daily feed ceiling.
 *
 * The stored value is only ever a request: `resolveDailyCapG` clamps it to the
 * 500-5,000 g window and applies the platform factor wherever the cap is
 * enforced, so an edited or stale row cannot raise the real ceiling.
 */
export function DeviceDailyCapForm({
	deviceId,
	currentCapG,
	saveAction,
	canWrite = true,
}: DeviceDailyCapFormProps) {
	const t = useTranslations("dashboard.appSettings");
	const [capG, setCapG] = useState(currentCapG ?? DEFAULT_DAILY_CAP_G);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [isPending, startTransition] = useTransition();

	const handleSave = () => {
		setError(null);
		setSaved(false);
		startTransition(async () => {
			const result = await saveAction(deviceId, Number(capG));
			if (result.success) {
				setSaved(true);
				toast.success(t("dailyCeilingSaved"));
			} else {
				const message = result.error ?? t("dailyCeilingError");
				setError(message);
				toast.error(message);
			}
		});
	};

	return (
		<div className="space-y-4" data-help="device-daily-ceiling">
			<div>
				<label htmlFor="dailyCapG" className={dashboardLabel}>
					{t("dailyCeilingLabel")}
				</label>
				<input
					id="dailyCapG"
					type="number"
					min={DAILY_CAP_MIN_G}
					max={MAX_FEED_GRAMS_PER_DAY_PER_DEVICE}
					step={50}
					inputMode="numeric"
					value={capG}
					onChange={(e) => setCapG(Number(e.target.value))}
					disabled={!canWrite || isPending}
					className={dashboardField}
				/>
				<span className={dashboardHint}>{t("dailyCeilingHint")}</span>
			</div>

			{error && <p className="text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>}
			{!error && saved && (
				<p className="text-sm font-semibold text-green-600 dark:text-green-400">
					{t("dailyCeilingSaved")}
				</p>
			)}

			<button
				type="button"
				onClick={handleSave}
				disabled={!canWrite || isPending}
				className={dashboardButtonPrimary}
			>
				{isPending ? t("saving") : t("dailyCeilingSave")}
			</button>
		</div>
	);
}
