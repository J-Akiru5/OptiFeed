"use client";

import {
	adminButtonPrimary,
	adminButtonSecondary,
	adminField,
} from "@/components/admin/admin-classes";
import { useRouter } from "@/i18n/routing";
import { moveDeviceToPond, unassignDevice } from "@/lib/actions/ponds";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

/**
 * Device-to-pond controls (#202 / decision E22).
 *
 * Both actions are tenant-admin server actions that re-check the org scope.
 * "Unassign" is destructive enough to need a second click, but it is not a
 * modal: the warning and the confirm button replace the control inline, which
 * keeps the dedicated-page rule intact.
 */

export function UnassignDeviceButton({
	deviceId,
	deviceLabel,
}: {
	deviceId: string;
	deviceLabel: string;
}) {
	const t = useTranslations("dashboard.adminPondDetail");
	const router = useRouter();
	const [confirming, setConfirming] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function run() {
		setPending(true);
		setError(null);
		try {
			const result = await unassignDevice(deviceId);
			if ("error" in result) {
				setError(result.error);
				return;
			}
			setConfirming(false);
			router.refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : t("unassignError"));
		} finally {
			setPending(false);
		}
	}

	if (!confirming) {
		return (
			<button
				type="button"
				onClick={() => {
					setError(null);
					setConfirming(true);
				}}
				className={adminButtonSecondary}
			>
				{t("unassign")}
			</button>
		);
	}

	return (
		<fieldset
			aria-label={t("unassignGroup", { label: deviceLabel })}
			className="max-w-xs space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-950/30"
		>
			<p className="text-[11px] font-bold text-[#8A4B08] dark:text-amber-200">
				{t("unassignWarning")}
			</p>
			{error && (
				<p role="alert" className="text-[11px] font-black text-[#C42B3A] dark:text-red-300">
					{error}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					onClick={run}
					disabled={pending}
					aria-busy={pending}
					className="inline-flex items-center gap-1.5 rounded-lg bg-[#C42B3A] px-3 py-1.5 text-xs font-black text-white transition-colors hover:bg-[#A8202D] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:opacity-60 dark:focus-visible:outline-[#8fc0ea]"
				>
					{pending && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}
					{t("unassignConfirm")}
				</button>
				<button
					type="button"
					onClick={() => setConfirming(false)}
					disabled={pending}
					className={adminButtonSecondary}
				>
					{t("unassignCancel")}
				</button>
			</div>
		</fieldset>
	);
}

export type MovableDevice = {
	id: string;
	label: string;
	mac: string;
	pondName: string | null;
};

export function MoveDeviceForm({
	targetPondId,
	devices,
}: {
	targetPondId: string;
	devices: MovableDevice[];
}) {
	const t = useTranslations("dashboard.adminPondDetail");
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	if (devices.length === 0) {
		return <p className="text-xs text-[#3D5568] dark:text-gray-400">{t("moveEmpty")}</p>;
	}

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const deviceId = String(new FormData(form).get("deviceId") ?? "");
		setPending(true);
		setError(null);
		setSuccess(false);
		try {
			const result = await moveDeviceToPond({ deviceId, targetPondId });
			if ("error" in result) {
				setError(result.error);
				return;
			}
			setSuccess(true);
			form.reset();
			router.refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : t("moveError"));
		} finally {
			setPending(false);
		}
	}

	return (
		<form onSubmit={onSubmit} className="space-y-3">
			<p className="text-xs text-[#3D5568] dark:text-gray-400">{t("moveDesc")}</p>
			<div className="flex flex-wrap items-end gap-3">
				<div className="min-w-0 flex-1">
					<label
						htmlFor="move-device"
						className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-300"
					>
						{t("moveSelectLabel")}
					</label>
					<select
						id="move-device"
						name="deviceId"
						required
						disabled={pending}
						className={adminField}
					>
						{devices.map((device) => (
							<option key={device.id} value={device.id}>
								{device.label}
								{device.pondName
									? ` — ${t("moveFromPond", { pond: device.pondName })}`
									: ` — ${t("moveUnassigned")}`}
							</option>
						))}
					</select>
				</div>
				<button type="submit" disabled={pending} aria-busy={pending} className={adminButtonPrimary}>
					{pending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
					{t("moveSubmit")}
				</button>
			</div>
			{error && (
				<p role="alert" className="text-xs font-bold text-[#C42B3A] dark:text-red-300">
					{error}
				</p>
			)}
			{success && (
				<output className="text-xs font-bold text-[#1E7B34] dark:text-green-300">
					{t("moveSuccess")}
				</output>
			)}
		</form>
	);
}
