"use client";

import { adminField, adminHint, adminLabel, adminSurface } from "@/components/admin/admin-classes";
import { useRouter } from "@/i18n/routing";
import { updateOrgSettings } from "@/lib/actions/org-settings";
import { MEMBER_ROLES } from "@/lib/auth/member-rules";
import {
	ORG_DEFAULT_FEEDING_RATE_MAX,
	ORG_DEFAULT_FEEDING_RATE_MIN,
	ORG_HOPPER_LOW_PCT_MAX,
	ORG_HOPPER_LOW_PCT_MIN,
	ORG_OFFLINE_AFTER_MIN_MAX,
	ORG_OFFLINE_AFTER_MIN_MIN,
	type OrgSettings,
} from "@/lib/settings/org-shared";
import type { MemberRole } from "@prisma/client";
import { Bell, Gauge, Router } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

/**
 * The three tenant settings cards (issue #190 / decision E6).
 *
 * Each card saves on its own so a bad notification threshold cannot block a
 * feeding-rate change. The action re-reads the current row and merges the patch,
 * so two cards saving concurrently cannot erase each other's fields.
 */

function Card({
	icon,
	title,
	description,
	children,
}: {
	icon: ReactNode;
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<section className={`${adminSurface} p-6`}>
			<div className="mb-5 flex items-start gap-3">
				<span
					aria-hidden="true"
					className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0A3D62]/10 dark:bg-white/10"
				>
					{icon}
				</span>
				<div>
					<h2 className="font-black text-[#0A3D62] dark:text-[#8fc0ea]">{title}</h2>
					<p className="mt-0.5 text-xs text-[#3D5568] dark:text-gray-400">{description}</p>
				</div>
			</div>
			{children}
		</section>
	);
}

function ErrorNote({ message }: { message: string }) {
	return (
		<div
			role="alert"
			className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-[#C42B3A] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
		>
			{message}
		</div>
	);
}

function SaveButton({
	loading,
	label,
	pendingLabel,
}: {
	loading: boolean;
	label: string;
	pendingLabel: string;
}) {
	return (
		<button
			type="submit"
			disabled={loading}
			aria-busy={loading}
			className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#C2410C] px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-[#9A3412] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:outline-[#8fc0ea]"
		>
			{loading ? pendingLabel : label}
		</button>
	);
}

/** Shared submit plumbing: error state, toast, refresh, loading flag. */
function useSettingsSave(orgId: string, disabled: boolean) {
	const t = useTranslations("dashboard.adminSettings");
	const router = useRouter();
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function save(patch: Parameters<typeof updateOrgSettings>[0]) {
		if (disabled) return;
		setError(null);
		setSaving(true);
		try {
			const result = await updateOrgSettings({ ...patch, orgId });
			if ("error" in result) {
				setError(result.error);
				toast.error(t("saveError"));
				return;
			}
			toast.success(t("saved"));
			router.refresh();
		} catch {
			setError(t("saveError"));
			toast.error(t("saveError"));
		} finally {
			setSaving(false);
		}
	}

	return { save, saving, error, t };
}

const iconClass = "h-5 w-5 text-[#0A3D62] dark:text-[#8fc0ea]";

export function DefaultFeedingRateForm({
	orgId,
	settings,
	canManage,
}: {
	orgId: string;
	settings: OrgSettings;
	canManage: boolean;
}) {
	const { save, saving, error, t } = useSettingsSave(orgId, !canManage);
	const [rate, setRate] = useState(String(settings.defaultFeedingRatePct));

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const value = Number.parseFloat(rate);
		if (!Number.isFinite(value)) {
			toast.error(t("saveError"));
			return;
		}
		void save({ defaultFeedingRatePct: value });
	}

	return (
		<Card
			icon={<Gauge className={iconClass} />}
			title={t("defaultFeedingRateTitle")}
			description={t("defaultFeedingRateDesc")}
		>
			<form onSubmit={onSubmit} className="space-y-4">
				{error && <ErrorNote message={error} />}
				<div>
					<label htmlFor="defaultFeedingRatePct" className={adminLabel}>
						{t("defaultRateLabel")}
					</label>
					<div className="flex items-center gap-2">
						<input
							id="defaultFeedingRatePct"
							name="defaultFeedingRatePct"
							type="number"
							step="0.1"
							min={ORG_DEFAULT_FEEDING_RATE_MIN}
							max={ORG_DEFAULT_FEEDING_RATE_MAX}
							value={rate}
							onChange={(event) => setRate(event.target.value)}
							disabled={!canManage || saving}
							className={`${adminField} max-w-32`}
						/>
						<span className="text-sm font-bold text-[#3D5568] dark:text-gray-300">
							{t("percentOfBodyWeight")}
						</span>
					</div>
					<p className={adminHint}>{t("defaultRateHint")}</p>
				</div>
				<SaveButton loading={saving} label={t("save")} pendingLabel={t("saving")} />
			</form>
		</Card>
	);
}

export function NotificationSettingsForm({
	orgId,
	settings,
	canManage,
}: {
	orgId: string;
	settings: OrgSettings;
	canManage: boolean;
}) {
	const { save, saving, error, t } = useSettingsSave(orgId, !canManage);
	const [hopperLow, setHopperLow] = useState(String(settings.hopperLowPct));
	const [offlineAfter, setOfflineAfter] = useState(String(settings.offlineAfterMin));
	const [missedFeeding, setMissedFeeding] = useState(settings.missedFeedingAlerts);
	const [roles, setRoles] = useState<MemberRole[]>(settings.alertRoles);

	function toggleRole(role: MemberRole, checked: boolean) {
		setRoles((current) =>
			checked
				? [...new Set([...current, role])]
				: current.filter((candidate) => candidate !== role),
		);
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (roles.length === 0) {
			toast.error(t("rolesRequired"));
			return;
		}
		void save({
			hopperLowPct: Number.parseInt(hopperLow, 10),
			offlineAfterMin: Number.parseInt(offlineAfter, 10),
			missedFeedingAlerts: missedFeeding,
			alertRoles: roles,
		});
	}

	return (
		<Card
			icon={<Bell className={iconClass} />}
			title={t("notificationsTitle")}
			description={t("notificationsDesc")}
		>
			<form onSubmit={onSubmit} className="space-y-4">
				{error && <ErrorNote message={error} />}

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label htmlFor="hopperLowPct" className={adminLabel}>
							{t("hopperLowLabel")}
						</label>
						<input
							id="hopperLowPct"
							name="hopperLowPct"
							type="number"
							min={ORG_HOPPER_LOW_PCT_MIN}
							max={ORG_HOPPER_LOW_PCT_MAX}
							value={hopperLow}
							onChange={(event) => setHopperLow(event.target.value)}
							disabled={!canManage || saving}
							className={adminField}
						/>
						<p className={adminHint}>{t("hopperLowHint")}</p>
					</div>
					<div>
						<label htmlFor="offlineAfterMin" className={adminLabel}>
							{t("offlineAfterLabel")}
						</label>
						<input
							id="offlineAfterMin"
							name="offlineAfterMin"
							type="number"
							min={ORG_OFFLINE_AFTER_MIN_MIN}
							max={ORG_OFFLINE_AFTER_MIN_MAX}
							value={offlineAfter}
							onChange={(event) => setOfflineAfter(event.target.value)}
							disabled={!canManage || saving}
							className={adminField}
						/>
						<p className={adminHint}>{t("offlineAfterHint")}</p>
					</div>
				</div>

				<label className="flex items-start gap-2 text-sm font-bold text-[#0A3D62] dark:text-gray-200">
					<input
						type="checkbox"
						name="missedFeedingAlerts"
						checked={missedFeeding}
						onChange={(event) => setMissedFeeding(event.target.checked)}
						disabled={!canManage || saving}
						className="mt-0.5 h-4 w-4 accent-[#0A3D62]"
					/>
					<span>
						{t("missedFeedingLabel")}
						<span className="block text-[11px] font-normal text-[#3D5568] dark:text-gray-400">
							{t("missedFeedingHint")}
						</span>
					</span>
				</label>

				<fieldset className="m-0 border-0 p-0">
					<legend className={adminLabel}>{t("rolesLabel")}</legend>
					<p className={`${adminHint} mb-2`}>{t("rolesHint")}</p>
					<div className="grid grid-cols-2 gap-2">
						{MEMBER_ROLES.map((role) => (
							<label
								key={role}
								className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-2 text-xs font-bold text-[#0A3D62] dark:border-gray-700 dark:text-gray-200"
							>
								<input
									type="checkbox"
									checked={roles.includes(role)}
									onChange={(event) => toggleRole(role, event.target.checked)}
									disabled={!canManage || saving}
									className="h-4 w-4 accent-[#0A3D62]"
								/>
								{t(`roles.${role}`)}
							</label>
						))}
					</div>
				</fieldset>

				<SaveButton loading={saving} label={t("save")} pendingLabel={t("saving")} />
			</form>
		</Card>
	);
}

export function DeviceRegistrationForm({
	orgId,
	settings,
	canManage,
}: {
	orgId: string;
	settings: OrgSettings;
	canManage: boolean;
}) {
	const { save, saving, error, t } = useSettingsSave(orgId, !canManage);
	const [mode, setMode] = useState<"ADMIN_APPROVAL" | "SELF_REGISTER">(settings.deviceRegistration);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		void save({ deviceRegistration: mode });
	}

	return (
		<Card
			icon={<Router className={iconClass} />}
			title={t("deviceRegistrationTitle")}
			description={t("deviceRegistrationDesc")}
		>
			<form onSubmit={onSubmit} className="space-y-4">
				{error && <ErrorNote message={error} />}
				<fieldset className="m-0 space-y-2 border-0 p-0">
					<legend className={adminLabel}>{t("registrationModeLabel")}</legend>
					<label className="flex items-start gap-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
						<input
							type="radio"
							name="deviceRegistration"
							value="ADMIN_APPROVAL"
							checked={mode === "ADMIN_APPROVAL"}
							onChange={() => setMode("ADMIN_APPROVAL")}
							disabled={!canManage || saving}
							className="mt-0.5 h-4 w-4 accent-[#0A3D62]"
						/>
						<span>
							<span className="block text-sm font-black text-[#0A3D62] dark:text-gray-100">
								{t("adminApprovalTitle")}
							</span>
							<span className="block text-[11px] text-[#3D5568] dark:text-gray-400">
								{t("adminApprovalDesc")}
							</span>
						</span>
					</label>
					<label className="flex items-start gap-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
						<input
							type="radio"
							name="deviceRegistration"
							value="SELF_REGISTER"
							checked={mode === "SELF_REGISTER"}
							onChange={() => setMode("SELF_REGISTER")}
							disabled={!canManage || saving}
							className="mt-0.5 h-4 w-4 accent-[#0A3D62]"
						/>
						<span>
							<span className="block text-sm font-black text-[#0A3D62] dark:text-gray-100">
								{t("selfRegisterTitle")}
							</span>
							<span className="block text-[11px] text-[#3D5568] dark:text-gray-400">
								{t("selfRegisterDesc")}
							</span>
						</span>
					</label>
				</fieldset>
				<SaveButton loading={saving} label={t("save")} pendingLabel={t("saving")} />
			</form>
		</Card>
	);
}
