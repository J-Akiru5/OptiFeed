"use client";

import {
	FIELD_HINT,
	FIELD_INPUT,
	FIELD_LABEL,
	FOCUS_RING,
	PRIMARY_BUTTON,
} from "@/components/superadmin/ui";
import { useRouter } from "@/i18n/routing";
import { setDeviceStatusThresholds } from "@/lib/actions/platform/settings";
import {
	DEVICE_OFFLINE_AFTER_MIN_MAX,
	DEVICE_OFFLINE_AFTER_MIN_MIN,
	DEVICE_OFFLINE_GRACE_MIN_MAX,
	DEVICE_OFFLINE_GRACE_MIN_MIN,
	DEVICE_WEAK_AFTER_MIN_MAX,
	DEVICE_WEAK_AFTER_MIN_MIN,
	type DeviceStatusSettingValue,
} from "@/lib/device-status";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

/**
 * Device connectivity thresholds (issue #388).
 *
 * Three whole-minute fields and the required audit reason. The same bounds are
 * enforced server-side; this form only gives the reader an inline check first.
 */
export function DeviceStatusSettings({ initial }: { initial: DeviceStatusSettingValue }) {
	const t = useTranslations("superadmin.settings.deviceStatus");
	const router = useRouter();
	const [weakAfter, setWeakAfter] = useState(String(initial.weakAfterMin));
	const [offlineAfter, setOfflineAfter] = useState(String(initial.offlineAfterMin));
	const [grace, setGrace] = useState(String(initial.graceMin));
	const [reason, setReason] = useState("");
	const [pending, setPending] = useState(false);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const weak = Number.parseInt(weakAfter, 10);
		const offline = Number.parseInt(offlineAfter, 10);
		const graceMin = Number.parseInt(grace, 10);
		if (
			!Number.isInteger(weak) ||
			!Number.isInteger(offline) ||
			!Number.isInteger(graceMin) ||
			weak < DEVICE_WEAK_AFTER_MIN_MIN ||
			weak > DEVICE_WEAK_AFTER_MIN_MAX ||
			offline < DEVICE_OFFLINE_AFTER_MIN_MIN ||
			offline > DEVICE_OFFLINE_AFTER_MIN_MAX ||
			graceMin < DEVICE_OFFLINE_GRACE_MIN_MIN ||
			graceMin > DEVICE_OFFLINE_GRACE_MIN_MAX ||
			weak >= offline
		) {
			toast.error(t("invalid"));
			return;
		}

		setPending(true);
		try {
			const result = await setDeviceStatusThresholds(
				{ weakAfterMin: weak, offlineAfterMin: offline, graceMin },
				reason,
			);
			if ("error" in result) {
				toast.error(result.error);
				return;
			}
			toast.success(
				t("saved", {
					weak: result.value.weakAfterMin,
					offline: result.value.offlineAfterMin,
					grace: result.value.graceMin,
				}),
			);
			setReason("");
			router.refresh();
		} catch {
			toast.error(t("failed"));
		} finally {
			setPending(false);
		}
	};

	return (
		<div className="rounded-2xl border border-gray-200 dark:border-[#24304A] bg-white dark:bg-[#111A2C] p-5 shadow-sm">
			<form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-3">
				<label className="block">
					<span className={FIELD_LABEL}>{t("weakLabel")}</span>
					<input
						type="number"
						inputMode="numeric"
						min={DEVICE_WEAK_AFTER_MIN_MIN}
						max={DEVICE_WEAK_AFTER_MIN_MAX}
						step={1}
						required
						value={weakAfter}
						onChange={(event) => setWeakAfter(event.target.value)}
						className={`${FIELD_INPUT} mt-1`}
						aria-describedby="device-weak-hint"
					/>
					<span id="device-weak-hint" className={`${FIELD_HINT} mt-1 block`}>
						{t("weakHint", {
							min: DEVICE_WEAK_AFTER_MIN_MIN,
							max: DEVICE_WEAK_AFTER_MIN_MAX,
						})}
					</span>
				</label>

				<label className="block">
					<span className={FIELD_LABEL}>{t("offlineLabel")}</span>
					<input
						type="number"
						inputMode="numeric"
						min={DEVICE_OFFLINE_AFTER_MIN_MIN}
						max={DEVICE_OFFLINE_AFTER_MIN_MAX}
						step={1}
						required
						value={offlineAfter}
						onChange={(event) => setOfflineAfter(event.target.value)}
						className={`${FIELD_INPUT} mt-1`}
						aria-describedby="device-offline-hint"
					/>
					<span id="device-offline-hint" className={`${FIELD_HINT} mt-1 block`}>
						{t("offlineHint", {
							min: DEVICE_OFFLINE_AFTER_MIN_MIN,
							max: DEVICE_OFFLINE_AFTER_MIN_MAX,
						})}
					</span>
				</label>

				<label className="block">
					<span className={FIELD_LABEL}>{t("graceLabel")}</span>
					<input
						type="number"
						inputMode="numeric"
						min={DEVICE_OFFLINE_GRACE_MIN_MIN}
						max={DEVICE_OFFLINE_GRACE_MIN_MAX}
						step={1}
						required
						value={grace}
						onChange={(event) => setGrace(event.target.value)}
						className={`${FIELD_INPUT} mt-1`}
						aria-describedby="device-grace-hint"
					/>
					<span id="device-grace-hint" className={`${FIELD_HINT} mt-1 block`}>
						{t("graceHint", {
							min: DEVICE_OFFLINE_GRACE_MIN_MIN,
							max: DEVICE_OFFLINE_GRACE_MIN_MAX,
						})}
					</span>
				</label>

				<label className="block md:col-span-2">
					<span className={FIELD_LABEL}>{t("reasonLabel")}</span>
					<input
						type="text"
						required
						minLength={10}
						maxLength={500}
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						placeholder={t("reasonPlaceholder")}
						className={`${FIELD_INPUT} mt-1`}
						aria-describedby="device-status-reason-hint"
					/>
					<span id="device-status-reason-hint" className={`${FIELD_HINT} mt-1 block`}>
						{t("reasonHint")}
					</span>
				</label>

				<div className="flex items-end">
					<button
						type="submit"
						disabled={pending}
						className={`${PRIMARY_BUTTON} ${FOCUS_RING} w-full`}
					>
						{pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
						{pending ? t("saving") : t("save")}
					</button>
				</div>
			</form>
			<p className={`${FIELD_HINT} mt-3`}>
				{t("summary", {
					offline: initial.offlineAfterMin,
					grace: initial.graceMin,
					total: initial.offlineAfterMin + initial.graceMin,
				})}
			</p>
		</div>
	);
}
