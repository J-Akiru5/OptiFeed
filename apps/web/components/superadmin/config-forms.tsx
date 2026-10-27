"use client";

import { FIELD_HINT, FIELD_INPUT, FIELD_LABEL, PRIMARY_BUTTON } from "@/components/superadmin/ui";
import { useRouter } from "@/i18n/routing";
import {
	setFeatureFlag,
	setFeedingSafetyCaps,
	setOrgDefaults,
} from "@/lib/actions/platform/config";
import { cn } from "@/lib/utils";
import type { DeviceRegistrationMode, MemberRole } from "@prisma/client";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

/**
 * Writeable configuration-centre sections (I-14).
 *
 * Each form owns one setting and saves on its own, so a bad value in one
 * section cannot block the others. Every save carries the reason the platform
 * audit row requires; the server action re-validates both the payload and the
 * reason, so this UI is convenience, not the guard.
 */

const MIN_REASON_LENGTH = 10;

function ReasonField({
	value,
	onChange,
	id,
	label,
	placeholder,
	hint,
}: {
	value: string;
	onChange: (value: string) => void;
	id: string;
	label: string;
	placeholder: string;
	hint: string;
}) {
	return (
		<label className="block">
			<span className={FIELD_LABEL}>{label}</span>
			<input
				type="text"
				required
				minLength={MIN_REASON_LENGTH}
				maxLength={500}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				className={`${FIELD_INPUT} mt-1`}
				aria-describedby={`${id}-hint`}
			/>
			<span id={`${id}-hint`} className={`${FIELD_HINT} mt-1 block`}>
				{hint}
			</span>
		</label>
	);
}

function SaveButton({ pending, label }: { pending: boolean; label: string }) {
	const t = useTranslations("superadmin.settings");
	return (
		<button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
			{pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
			{pending ? t("saving") : label}
		</button>
	);
}

function FormCard({ children }: { children: ReactNode }) {
	return (
		<div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">{children}</div>
	);
}

export type FeedingCapsValues = {
	maxDispenseMs: number;
	dailyCapFactor: number;
};

/** Relay-time and daily-allowance ceilings. Both can only be lowered. */
export function FeedingCapsForm({
	initial,
	min,
	hardMax,
}: {
	initial: FeedingCapsValues;
	min: FeedingCapsValues;
	hardMax: FeedingCapsValues;
}) {
	const t = useTranslations("superadmin.settings");
	const router = useRouter();
	const [maxDispenseMs, setMaxDispenseMs] = useState(String(initial.maxDispenseMs));
	const [dailyCapFactor, setDailyCapFactor] = useState(String(initial.dailyCapFactor));
	const [reason, setReason] = useState("");
	const [pending, setPending] = useState(false);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const nextMax = Number(maxDispenseMs);
		const nextFactor = Number(dailyCapFactor);
		if (
			!Number.isInteger(nextMax) ||
			nextMax < min.maxDispenseMs ||
			nextMax > hardMax.maxDispenseMs ||
			!Number.isFinite(nextFactor) ||
			nextFactor < min.dailyCapFactor ||
			nextFactor > hardMax.dailyCapFactor
		) {
			toast.error(t("safety.invalid"));
			return;
		}
		setPending(true);
		try {
			const result = await setFeedingSafetyCaps(
				{ maxDispenseMs: nextMax, dailyCapFactor: nextFactor },
				reason,
			);
			if ("error" in result) {
				toast.error(result.error);
				return;
			}
			toast.success(t("safety.saved"));
			setReason("");
			router.refresh();
		} catch {
			toast.error(t("failed"));
		} finally {
			setPending(false);
		}
	};

	return (
		<FormCard>
			<form onSubmit={handleSubmit} className="space-y-4">
				<div className="grid gap-4 sm:grid-cols-2">
					<label className="block">
						<span className={FIELD_LABEL}>{t("safety.maxDispenseLabel")}</span>
						<input
							type="number"
							inputMode="numeric"
							min={min.maxDispenseMs}
							max={hardMax.maxDispenseMs}
							step={1000}
							required
							value={maxDispenseMs}
							onChange={(event) => setMaxDispenseMs(event.target.value)}
							className={`${FIELD_INPUT} mt-1`}
							aria-describedby="feeding-max-dispense-hint"
						/>
						<span id="feeding-max-dispense-hint" className={`${FIELD_HINT} mt-1 block`}>
							{t("safety.maxDispenseHint", {
								min: min.maxDispenseMs,
								max: hardMax.maxDispenseMs,
							})}
						</span>
					</label>

					<label className="block">
						<span className={FIELD_LABEL}>{t("safety.dailyCapLabel")}</span>
						<input
							type="number"
							inputMode="decimal"
							min={min.dailyCapFactor}
							max={hardMax.dailyCapFactor}
							step={0.05}
							required
							value={dailyCapFactor}
							onChange={(event) => setDailyCapFactor(event.target.value)}
							className={`${FIELD_INPUT} mt-1`}
							aria-describedby="feeding-daily-cap-hint"
						/>
						<span id="feeding-daily-cap-hint" className={`${FIELD_HINT} mt-1 block`}>
							{t("safety.dailyCapHint", {
								min: min.dailyCapFactor,
								max: hardMax.dailyCapFactor,
							})}
						</span>
					</label>
				</div>

				<p className="rounded-xl bg-[#F4F7F6] p-3 text-xs text-[#3D5568]">
					{t("safety.hardMaxNote", {
						ms: hardMax.maxDispenseMs,
						factor: hardMax.dailyCapFactor,
					})}
				</p>

				<ReasonField
					id="feeding-caps-reason"
					value={reason}
					onChange={setReason}
					label={t("reasonLabel")}
					placeholder={t("reasonPlaceholder")}
					hint={t("reasonHint")}
				/>

				<SaveButton pending={pending} label={t("safety.save")} />
			</form>
		</FormCard>
	);
}

export type OrgDefaultsValues = {
	defaultFeedingRatePct: number;
	hopperLowPct: number;
	offlineAfterMin: number;
	missedFeedingAlerts: boolean;
	alertRoles: MemberRole[];
	deviceRegistration: DeviceRegistrationMode;
};

export type OrgDefaultsBounds = {
	feedingRateMin: number;
	feedingRateMax: number;
	hopperLowMin: number;
	hopperLowMax: number;
	offlineAfterMinMin: number;
	offlineAfterMinMax: number;
};

/** Defaults a new organization starts from when it has no OrgSetting row. */
export function OrgDefaultsForm({
	initial,
	bounds,
	roles,
	modes,
	adminApprovalMode,
}: {
	initial: OrgDefaultsValues;
	bounds: OrgDefaultsBounds;
	roles: readonly MemberRole[];
	modes: readonly DeviceRegistrationMode[];
	adminApprovalMode: DeviceRegistrationMode;
}) {
	const t = useTranslations("superadmin.settings");
	const tRoles = useTranslations("superadmin.roles");
	const router = useRouter();
	const [feedingRate, setFeedingRate] = useState(String(initial.defaultFeedingRatePct));
	const [hopperLow, setHopperLow] = useState(String(initial.hopperLowPct));
	const [offlineAfter, setOfflineAfter] = useState(String(initial.offlineAfterMin));
	const [missedFeeding, setMissedFeeding] = useState(initial.missedFeedingAlerts);
	const [alertRoles, setAlertRoles] = useState<MemberRole[]>(initial.alertRoles);
	const [mode, setMode] = useState<DeviceRegistrationMode>(initial.deviceRegistration);
	const [reason, setReason] = useState("");
	const [pending, setPending] = useState(false);

	const toggleRole = (role: MemberRole) => {
		setAlertRoles((current) =>
			current.includes(role) ? current.filter((entry) => entry !== role) : [...current, role],
		);
	};

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const next = {
			defaultFeedingRatePct: Number(feedingRate),
			hopperLowPct: Number.parseInt(hopperLow, 10),
			offlineAfterMin: Number.parseInt(offlineAfter, 10),
			missedFeedingAlerts: missedFeeding,
			alertRoles,
			deviceRegistration: mode,
		};
		if (
			!Number.isFinite(next.defaultFeedingRatePct) ||
			!Number.isInteger(next.hopperLowPct) ||
			!Number.isInteger(next.offlineAfterMin) ||
			next.alertRoles.length === 0
		) {
			toast.error(t("defaults.invalid"));
			return;
		}
		setPending(true);
		try {
			const result = await setOrgDefaults(next, reason);
			if ("error" in result) {
				toast.error(result.error);
				return;
			}
			toast.success(t("defaults.saved"));
			setReason("");
			router.refresh();
		} catch {
			toast.error(t("failed"));
		} finally {
			setPending(false);
		}
	};

	return (
		<FormCard>
			<form onSubmit={handleSubmit} className="space-y-4">
				<div className="grid gap-4 sm:grid-cols-2">
					<label className="block">
						<span className={FIELD_LABEL}>{t("defaults.feedingRateLabel")}</span>
						<input
							type="number"
							inputMode="decimal"
							min={bounds.feedingRateMin}
							max={bounds.feedingRateMax}
							step={0.1}
							required
							value={feedingRate}
							onChange={(event) => setFeedingRate(event.target.value)}
							className={`${FIELD_INPUT} mt-1`}
							aria-describedby="org-defaults-rate-hint"
						/>
						<span id="org-defaults-rate-hint" className={`${FIELD_HINT} mt-1 block`}>
							{t("defaults.feedingRateHint", {
								min: bounds.feedingRateMin,
								max: bounds.feedingRateMax,
							})}
						</span>
					</label>

					<label className="block">
						<span className={FIELD_LABEL}>{t("defaults.hopperLowLabel")}</span>
						<input
							type="number"
							inputMode="numeric"
							min={bounds.hopperLowMin}
							max={bounds.hopperLowMax}
							step={1}
							required
							value={hopperLow}
							onChange={(event) => setHopperLow(event.target.value)}
							className={`${FIELD_INPUT} mt-1`}
							aria-describedby="org-defaults-hopper-hint"
						/>
						<span id="org-defaults-hopper-hint" className={`${FIELD_HINT} mt-1 block`}>
							{t("defaults.hopperLowHint", {
								min: bounds.hopperLowMin,
								max: bounds.hopperLowMax,
							})}
						</span>
					</label>

					<label className="block">
						<span className={FIELD_LABEL}>{t("defaults.offlineLabel")}</span>
						<input
							type="number"
							inputMode="numeric"
							min={bounds.offlineAfterMinMin}
							max={bounds.offlineAfterMinMax}
							step={1}
							required
							value={offlineAfter}
							onChange={(event) => setOfflineAfter(event.target.value)}
							className={`${FIELD_INPUT} mt-1`}
							aria-describedby="org-defaults-offline-hint"
						/>
						<span id="org-defaults-offline-hint" className={`${FIELD_HINT} mt-1 block`}>
							{t("defaults.offlineHint", {
								min: bounds.offlineAfterMinMin,
								max: bounds.offlineAfterMinMax,
							})}
						</span>
					</label>

					<label className="block">
						<span className={FIELD_LABEL}>{t("defaults.deviceRegistrationLabel")}</span>
						<select
							value={mode}
							onChange={(event) => setMode(event.target.value as DeviceRegistrationMode)}
							className={`${FIELD_INPUT} mt-1`}
							aria-describedby="org-defaults-mode-hint"
						>
							{modes.map((option) => (
								<option key={option} value={option}>
									{option === adminApprovalMode
										? t("defaults.adminApproval")
										: t("defaults.selfRegister")}
								</option>
							))}
						</select>
						<span id="org-defaults-mode-hint" className={`${FIELD_HINT} mt-1 block`}>
							{t("defaults.deviceRegistrationHint")}
						</span>
					</label>
				</div>

				<label className="flex items-start gap-2 text-sm text-[#0A3D62]">
					<input
						type="checkbox"
						checked={missedFeeding}
						onChange={(event) => setMissedFeeding(event.target.checked)}
						className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#E85A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
					/>
					<span>{t("defaults.missedFeedingLabel")}</span>
				</label>

				<fieldset>
					<legend className={FIELD_LABEL}>{t("defaults.alertRolesLabel")}</legend>
					<div className="mt-2 flex flex-wrap gap-2">
						{roles.map((role) => {
							const checked = alertRoles.includes(role);
							return (
								<label
									key={role}
									className={cn(
										"flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-bold",
										checked
											? "border-[#E85A2A] bg-[#FFF3E8] text-[#0A3D62]"
											: "border-gray-200 bg-white text-[#3D5568]",
									)}
								>
									<input
										type="checkbox"
										checked={checked}
										onChange={() => toggleRole(role)}
										className="h-4 w-4 rounded border-gray-300 text-[#E85A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
									/>
									{tRoles(role)}
								</label>
							);
						})}
					</div>
					<p className={`${FIELD_HINT} mt-1`}>{t("defaults.alertRolesHint")}</p>
				</fieldset>

				<ReasonField
					id="org-defaults-reason"
					value={reason}
					onChange={setReason}
					label={t("reasonLabel")}
					placeholder={t("reasonPlaceholder")}
					hint={t("reasonHint")}
				/>

				<SaveButton pending={pending} label={t("defaults.save")} />
			</form>
		</FormCard>
	);
}

export type FeatureFlagRow = {
	key: string;
	id: string;
	enabled: boolean;
};

/** One row per declared flag; each toggle carries its own reason. */
export function FeatureFlagsForm({ flags }: { flags: FeatureFlagRow[] }) {
	return (
		<FormCard>
			<ul className="divide-y divide-gray-200">
				{flags.map((flag) => (
					<FeatureFlagRowForm key={flag.key} flag={flag} />
				))}
			</ul>
		</FormCard>
	);
}

function FeatureFlagRowForm({ flag }: { flag: FeatureFlagRow }) {
	const t = useTranslations("superadmin.settings");
	const router = useRouter();
	const [enabled, setEnabled] = useState(flag.enabled);
	const [reason, setReason] = useState("");
	const [pending, setPending] = useState(false);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setPending(true);
		try {
			const result = await setFeatureFlag(flag.key, enabled, reason);
			if ("error" in result) {
				toast.error(result.error);
				return;
			}
			toast.success(t("flags.saved"));
			setReason("");
			router.refresh();
		} catch {
			toast.error(t("failed"));
		} finally {
			setPending(false);
		}
	};

	return (
		<li className="py-4 first:pt-0 last:pb-0">
			<form onSubmit={handleSubmit} className="space-y-3">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<p className="text-sm font-black text-[#0A3D62]">{t(`flags.items.${flag.id}.title`)}</p>
						<p className={`${FIELD_HINT} mt-0.5 max-w-2xl`}>
							{t(`flags.items.${flag.id}.description`)}
						</p>
					</div>
					<label className="flex min-h-9 shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-1.5 text-xs font-black text-[#0A3D62]">
						<input
							type="checkbox"
							checked={enabled}
							onChange={(event) => setEnabled(event.target.checked)}
							className="h-4 w-4 rounded border-gray-300 text-[#E85A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
							aria-describedby={`flag-${flag.id}-state`}
						/>
						<span id={`flag-${flag.id}-state`}>{enabled ? t("flags.on") : t("flags.off")}</span>
					</label>
				</div>

				<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
					<ReasonField
						id={`flag-${flag.id}-reason`}
						value={reason}
						onChange={setReason}
						label={t("reasonLabel")}
						placeholder={t("reasonPlaceholder")}
						hint={t("reasonHint")}
					/>
					<div className="sm:pb-5">
						<SaveButton pending={pending} label={t("flags.save")} />
					</div>
				</div>
			</form>
		</li>
	);
}
