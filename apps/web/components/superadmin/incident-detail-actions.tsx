"use client";

import {
	FIELD_HINT,
	FIELD_INPUT,
	FIELD_LABEL,
	PRIMARY_BUTTON,
	SECONDARY_BUTTON,
} from "@/components/superadmin/ui";
import { useRouter } from "@/i18n/routing";
import {
	acknowledgePlatformIncident,
	escalatePlatformIncident,
	investigatePlatformIncident,
	resolvePlatformIncident,
} from "@/lib/actions/platform/incidents";
import type { PlatformIncidentOwner } from "@/lib/platform/incident-lifecycle";
import {
	PLATFORM_INCIDENT_ACTIONS,
	type PlatformIncidentAction,
	type PlatformIncidentStatus,
	targetStatusForAction,
} from "@/lib/platform/incident-lifecycle-rules";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Loader2, Megaphone, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

/**
 * Lifecycle controls for one tracked incident (issue #479, M3C.6).
 *
 * A review surface only: the platform-admin gate, the transition rules, the
 * reason, the timeline event, the audit row and the 30-minute escalation target
 * all live in `lib/actions/platform/incidents.ts`. This component offers only
 * the actions the pure rules say are legal for the current status, so a resolved
 * incident has no buttons and an escalated one can be acknowledged, investigated
 * or resolved.
 */

const ACTION_ICON = {
	acknowledge: ShieldCheck,
	investigate: AlertTriangle,
	resolve: CheckCircle2,
	escalate: Megaphone,
} as const;

export function IncidentDetailActions({
	incidentId,
	status,
	owners,
	ownersAvailable,
}: {
	incidentId: string;
	status: PlatformIncidentStatus;
	owners: PlatformIncidentOwner[];
	ownersAvailable: boolean;
}) {
	const t = useTranslations("superadmin.incidents");
	const tCommon = useTranslations("superadmin.common");
	const router = useRouter();

	const allowed = PLATFORM_INCIDENT_ACTIONS.filter(
		(action) => targetStatusForAction(action, status) !== null,
	);
	const [requestedAction, setRequestedAction] = useState<PlatformIncidentAction | null>(null);
	const selected =
		requestedAction && allowed.includes(requestedAction) ? requestedAction : (allowed[0] ?? null);
	const [reason, setReason] = useState("");
	const [ownerId, setOwnerId] = useState(owners[0]?.id ?? "");
	const [pending, setPending] = useState(false);
	const [done, setDone] = useState(false);
	const [errorCode, setErrorCode] = useState<string | null>(null);

	if (status === "RESOLVED" || allowed.length === 0) {
		return (
			<section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-[#24304A] dark:bg-[#111A2C]">
				<h2 className="text-sm font-black text-[#0A3D62] dark:text-slate-100">
					{t("actions.title")}
				</h2>
				<p className="mt-2 text-xs leading-relaxed text-[#3D5568] dark:text-slate-400">
					{t("actions.terminal")}
				</p>
			</section>
		);
	}

	const run = async (event: FormEvent) => {
		event.preventDefault();
		if (!selected) return;
		setErrorCode(null);
		setDone(false);
		if (reason.trim().length < 10) {
			setErrorCode("reason");
			return;
		}
		if (selected === "escalate" && !ownerId) {
			setErrorCode("owner_required");
			return;
		}

		setPending(true);
		try {
			const result =
				selected === "acknowledge"
					? await acknowledgePlatformIncident({ incidentId, reason })
					: selected === "investigate"
						? await investigatePlatformIncident({ incidentId, reason })
						: selected === "resolve"
							? await resolvePlatformIncident({ incidentId, reason })
							: await escalatePlatformIncident({ incidentId, ownerId, reason });

			if ("error" in result) {
				setErrorCode(result.code);
				return;
			}
			setReason("");
			setDone(true);
			router.refresh();
		} catch {
			setErrorCode("generic");
		} finally {
			setPending(false);
		}
	};

	const Icon = selected ? ACTION_ICON[selected] : CheckCircle2;
	const errorMessage = (() => {
		if (!errorCode) return null;
		if (
			errorCode === "invalid_transition" ||
			errorCode === "not_found" ||
			errorCode === "owner_required" ||
			errorCode === "owner_invalid" ||
			errorCode === "reason" ||
			errorCode === "conflict"
		) {
			return t(`actions.errors.${errorCode}`);
		}
		return t("actions.errors.generic");
	})();

	return (
		<section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-[#24304A] dark:bg-[#111A2C]">
			<h2 className="text-sm font-black text-[#0A3D62] dark:text-slate-100">
				{t("actions.title")}
			</h2>
			<p className="mt-1 text-xs leading-relaxed text-[#3D5568] dark:text-slate-400">
				{t("actions.body")}
			</p>

			<form className="mt-4 space-y-3" onSubmit={(event) => void run(event)}>
				<fieldset className="flex flex-wrap items-center gap-2">
					<legend className="sr-only">{t("actions.title")}</legend>
					{allowed.map((action) => {
						const ActionIcon = ACTION_ICON[action];
						const active = selected === action;
						return (
							<button
								key={action}
								type="button"
								aria-pressed={active}
								onClick={() => {
									setRequestedAction(action);
									setErrorCode(null);
								}}
								className={cn(
									SECONDARY_BUTTON,
									active && "bg-[#0A3D62] text-white dark:bg-[#1B3A57] dark:text-slate-100",
								)}
							>
								<ActionIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
								{t(`actions.${action}`)}
							</button>
						);
					})}
				</fieldset>

				{selected === "escalate" && (
					<div className="space-y-2">
						<label htmlFor="incident-owner" className={FIELD_LABEL}>
							{t("actions.ownerLabel")}
						</label>
						<select
							id="incident-owner"
							value={ownerId}
							onChange={(event) => setOwnerId(event.target.value)}
							disabled={!ownersAvailable || owners.length === 0}
							className={FIELD_INPUT}
						>
							{owners.length === 0 ? (
								<option value="">{t("actions.noOwners")}</option>
							) : (
								owners.map((owner) => (
									<option key={owner.id} value={owner.id}>
										{owner.label}
									</option>
								))
							)}
						</select>
						<p className={FIELD_HINT}>
							{ownersAvailable ? t("actions.ownerHint") : t("actions.ownerUnavailable")}
						</p>
					</div>
				)}

				<div className="space-y-2">
					<label htmlFor="incident-reason" className={FIELD_LABEL}>
						{tCommon("reasonRequired")}
					</label>
					<textarea
						id="incident-reason"
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						rows={2}
						maxLength={500}
						placeholder={tCommon("reasonPlaceholderShort")}
						className={FIELD_INPUT}
					/>
					<p className={FIELD_HINT}>{t("actions.reasonHint")}</p>
				</div>

				{errorMessage && (
					<p
						role="alert"
						className="rounded-xl border border-red-200 bg-red-50 p-2 text-[11px] font-bold text-[#C42B3A] dark:border-red-500/40 dark:bg-red-950/50 dark:text-red-300"
					>
						{errorMessage}
					</p>
				)}
				{done && (
					<output className="block rounded-xl border border-green-200 bg-green-50 p-2 text-[11px] font-bold text-green-800 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-300">
						{t("actions.done")}
					</output>
				)}

				<button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
					{pending ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
					) : (
						<Icon className="h-3.5 w-3.5" aria-hidden="true" />
					)}
					{pending ? t("actions.pending") : t("actions.submit")}
				</button>
			</form>
		</section>
	);
}
