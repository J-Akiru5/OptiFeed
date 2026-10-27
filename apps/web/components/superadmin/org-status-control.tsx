"use client";

import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import {
	DANGER_BUTTON,
	FIELD_HINT,
	FIELD_INPUT,
	FIELD_LABEL,
	PRIMARY_BUTTON,
} from "@/components/superadmin/ui";
import {
	type OrganizationStatus,
	setOrganizationStatus,
} from "@/lib/actions/platform/organizations";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

/**
 * Suspend / restore one organization (issue #194, E10).
 *
 * This is the button the assistant's suspend/restore proposal calls:
 * `setOrganizationStatus` with a written reason and a fresh step-up. The
 * control is a review surface only; every guard lives in the action.
 */
export function OrgStatusControl({
	orgId,
	orgName,
	status,
}: {
	orgId: string;
	orgName: string;
	status: string;
}) {
	const t = useTranslations("superadmin.orgDetail");
	const tCommon = useTranslations("superadmin.common");
	const [reason, setReason] = useState("");
	const [target, setTarget] = useState<OrganizationStatus | null>(null);
	const [stepUpOpen, setStepUpOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);

	const purged = status === "PURGED";
	const suspended = status === "SUSPENDED";

	const run = async (next: OrganizationStatus) => {
		setTarget(next);
		setError(null);
		setDone(null);
		setPending(true);
		try {
			const result = await setOrganizationStatus({ orgId, status: next, reason });
			if ("error" in result) {
				if (result.code === "step_up_required") {
					setStepUpOpen(true);
					return;
				}
				setError(result.error);
				return;
			}
			setReason("");
			setDone(next === "SUSPENDED" ? t("statusSuspendedDone") : t("statusRestoredDone"));
		} finally {
			setPending(false);
		}
	};

	const submit = (event: FormEvent, next: OrganizationStatus) => {
		event.preventDefault();
		if (reason.trim().length < 10) {
			setError(t("statusReasonTooShort"));
			return;
		}
		void run(next);
	};

	if (purged) {
		return (
			<section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
				<h2 className="text-sm font-black text-[#0A3D62]">{t("statusTitle")}</h2>
				<p className="mt-2 text-xs text-[#3D5568]">{t("statusPurged")}</p>
			</section>
		);
	}

	return (
		<section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
			<div className="flex items-start gap-3">
				<span
					className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
						suspended ? "bg-red-50 text-[#C42B3A]" : "bg-[#F4F7F6] text-[#0A3D62]"
					}`}
					aria-hidden="true"
				>
					{suspended ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
				</span>
				<div className="min-w-0">
					<h2 className="text-sm font-black text-[#0A3D62]">{t("statusTitle")}</h2>
					<p className="mt-1 text-xs leading-snug text-[#3D5568]">{t("statusBody")}</p>
					<p className="mt-1 text-[11px] font-bold text-[#3D5568]">
						{t("statusCurrent", { status: suspended ? t("statusSuspended") : t("statusActive") })}
					</p>
				</div>
			</div>

			<form
				className="mt-4 space-y-2"
				onSubmit={(event) => submit(event, suspended ? "ACTIVE" : "SUSPENDED")}
			>
				<label htmlFor="org-status-reason" className={FIELD_LABEL}>
					{tCommon("reasonRequired")}
				</label>
				<textarea
					id="org-status-reason"
					value={reason}
					onChange={(event) => setReason(event.target.value)}
					rows={2}
					maxLength={500}
					placeholder={tCommon("reasonPlaceholderShort")}
					className={FIELD_INPUT}
				/>
				<p className={FIELD_HINT}>{tCommon("reasonHelpShort")}</p>
				{error && (
					<p
						role="alert"
						className="rounded-xl border border-red-200 bg-red-50 p-2 text-[11px] font-bold text-[#C42B3A]"
					>
						{error}
					</p>
				)}
				{done && (
					<output className="block rounded-xl border border-green-200 bg-green-50 p-2 text-[11px] font-bold text-green-800">
						{done}
					</output>
				)}
				<button
					type="submit"
					disabled={pending}
					className={suspended ? PRIMARY_BUTTON : DANGER_BUTTON}
				>
					{pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
					{suspended ? t("restore") : t("suspend")}
				</button>
			</form>

			<StepUpDialog
				open={stepUpOpen}
				actionLabel={
					target === "SUSPENDED"
						? t("suspendActionLabel", { org: orgName })
						: t("restoreActionLabel", { org: orgName })
				}
				onClose={() => setStepUpOpen(false)}
				onVerified={() => {
					setStepUpOpen(false);
					if (target) void run(target);
				}}
			/>
		</section>
	);
}
