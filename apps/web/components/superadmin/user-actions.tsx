"use client";

import { DialogHeader, DialogShell } from "@/components/superadmin/dialog-shell";
import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import {
	FIELD_HINT,
	FIELD_LABEL,
	FOCUS_RING,
	PRIMARY_BUTTON,
	SECONDARY_BUTTON,
} from "@/components/superadmin/ui";
import { useRouter } from "@/i18n/routing";
import {
	type PlatformUserActionResult,
	disablePlatformUser,
	enablePlatformUser,
	grantPlatformAdmin,
	resetPlatformUserPassword,
	revokePlatformAdmin,
} from "@/lib/actions/superadmin";
import { cn } from "@/lib/utils";
import {
	Check,
	Copy,
	KeyRound,
	Loader2,
	MoreHorizontal,
	ShieldCheck,
	ShieldOff,
	Trash2,
	Undo2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";

type Mode = "grant" | "revoke" | "disable" | "enable" | "reset" | null;

const MIN_REASON = 10;

/**
 * Per-row platform actions: grant/revoke god-mode, or disable/enable an account.
 *
 * Every action demands a free-text reason because PlatformAuditLog.reason is
 * non-nullable (T5). Dangerous actions also require step-up: if the 5-minute
 * cookie is missing or expired, this component opens the password dialog and
 * retries the exact same action after verification.
 *
 * The panel is a modal (T-09c): it used to be an absolutely positioned popover
 * inside the table, which the table's horizontal scroll container clipped on
 * narrow screens and which gave keyboard focus nowhere to go.
 *
 * Disable is a safe delete (M3.10): it bans the login and revokes memberships,
 * so the UI asks the admin to type the login ID and offers Enable afterwards.
 */
export function UserActions({
	userId,
	farmId,
	isPlatformAdmin,
	disabled,
}: {
	userId: string;
	farmId: string;
	isPlatformAdmin: boolean;
	disabled: boolean;
}) {
	const t = useTranslations("superadmin.userActions");
	const tCommon = useTranslations("superadmin.common");
	const router = useRouter();
	const [mode, setMode] = useState<Mode>(null);
	const [reason, setReason] = useState("");
	const [confirmFarmId, setConfirmFarmId] = useState("");
	const [issuedPassword, setIssuedPassword] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [stepUpOpen, setStepUpOpen] = useState(false);
	const retryRef = useRef<(() => void) | null>(null);
	const [isPending, startTransition] = useTransition();

	const open = (next: Exclude<Mode, null>) => {
		setMode(next);
		setReason("");
		setConfirmFarmId("");
		setIssuedPassword(null);
		setCopied(false);
		setError(null);
	};
	const close = () => {
		if (isPending) return;
		setMode(null);
		setReason("");
		setConfirmFarmId("");
		setIssuedPassword(null);
		setCopied(false);
		setError(null);
	};

	const perform = (targetMode: Exclude<Mode, null>, trimmedReason: string) => {
		startTransition(async () => {
			try {
				if (targetMode === "reset") {
					const result = await resetPlatformUserPassword(userId, trimmedReason);
					if ("error" in result) {
						if (result.code === "step_up_required") {
							retryRef.current = () => perform(targetMode, trimmedReason);
							setStepUpOpen(true);
							return;
						}
						setError(result.error);
						return;
					}
					// Keep the dialog open on the one-time credential panel: the
					// value exists only in this browser state, never in a reload.
					setIssuedPassword(result.temporaryPassword);
					setReason("");
					setMode(null);
					router.refresh();
					return;
				}

				const result: PlatformUserActionResult =
					targetMode === "grant"
						? await grantPlatformAdmin(userId, trimmedReason)
						: targetMode === "revoke"
							? await revokePlatformAdmin(userId, trimmedReason)
							: targetMode === "enable"
								? await enablePlatformUser(userId, trimmedReason)
								: await disablePlatformUser(userId, trimmedReason, confirmFarmId);

				if ("error" in result) {
					if (result.code === "step_up_required") {
						// Keep the exact action; the dialog retries it after the
						// password check sets the cookie.
						retryRef.current = () => perform(targetMode, trimmedReason);
						setStepUpOpen(true);
						return;
					}
					setError(result.error);
					return;
				}

				setMode(null);
				setReason("");
				setConfirmFarmId("");
				router.refresh();
			} catch (e) {
				setError(e instanceof Error ? e.message : t("actionFailed"));
			}
		});
	};

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		const trimmed = reason.trim();
		if (trimmed.length < MIN_REASON) {
			setError(tCommon("reasonMinLength", { count: MIN_REASON }));
			return;
		}
		if (mode === "disable" && confirmFarmId.trim() !== farmId) {
			setError(t("typeToConfirm", { farmId }));
			return;
		}
		if (!mode) return;
		perform(mode, trimmed);
	};

	const onVerified = () => {
		setStepUpOpen(false);
		const retry = retryRef.current;
		retryRef.current = null;
		retry?.();
	};

	return (
		<>
			<button
				type="button"
				onClick={() => open(disabled ? "enable" : "grant")}
				disabled={isPending}
				data-help="superadmin-user-actions"
				aria-label={t("actionsFor", { farmId })}
				aria-haspopup="dialog"
				aria-expanded={mode !== null}
				className={cn(
					"rounded-xl p-2 text-[#3D5568] transition-colors hover:bg-[#F4F7F6] hover:text-[#0A3D62] disabled:opacity-50",
					FOCUS_RING,
				)}
			>
				<MoreHorizontal className="h-4 w-4" aria-hidden="true" />
			</button>

			<DialogShell
				open={mode !== null || issuedPassword !== null}
				onClose={close}
				labelledBy="user-actions-title"
				describedBy="user-actions-description"
				pending={isPending}
			>
				{issuedPassword && (
					<>
						<DialogHeader
							titleId="user-actions-title"
							descriptionId="user-actions-description"
							icon={KeyRound}
							title={t("issued.title")}
							description={
								<>
									{t("issued.descriptionPrefix")}{" "}
									<span className="font-mono font-bold text-[#0A3D62]">{farmId}</span>{" "}
									{t("issued.descriptionSuffix")}
								</>
							}
							onClose={close}
							closeDisabled={isPending}
							closeLabel={t("closeLabel")}
						/>

						<div className="mt-4 flex items-center gap-2 rounded-xl border border-[#E8C9A8] bg-[#FDF3E7] px-3 py-2.5 dark:border-[#FF8A5C]/30 dark:bg-[#FF8A5C]/10">
							<code className="min-w-0 flex-1 break-all font-mono text-sm font-black text-[#8A3B12] dark:text-[#FFB38F]">
								{issuedPassword}
							</code>
							<button
								type="button"
								onClick={() => {
									void navigator.clipboard
										?.writeText(issuedPassword)
										.then(() => setCopied(true))
										.catch(() => setCopied(false));
								}}
								aria-label={t("issued.copy")}
								className={cn(
									"inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#E8C9A8] px-2.5 py-1.5 text-[10px] font-black tracking-wider text-[#8A3B12] uppercase transition-colors hover:bg-white dark:border-[#FF8A5C]/30 dark:text-[#FFB38F] dark:hover:bg-white/10",
									FOCUS_RING,
								)}
							>
								{copied ? (
									<Check className="h-3.5 w-3.5" aria-hidden="true" />
								) : (
									<Copy className="h-3.5 w-3.5" aria-hidden="true" />
								)}
								{copied ? t("issued.copied") : t("issued.copy")}
							</button>
						</div>

						<p className="mt-3 text-[11px] font-bold leading-snug text-[#C42B3A]">
							{t("issued.warning")}
						</p>

						<div className="mt-4">
							<button
								type="button"
								onClick={close}
								className={cn(
									SECONDARY_BUTTON,
									"w-full px-3 py-2.5 text-xs font-bold text-[#3D5568] hover:bg-gray-200",
								)}
							>
								{t("issued.done")}
							</button>
						</div>
					</>
				)}
				{mode && (
					<>
						<DialogHeader
							titleId="user-actions-title"
							descriptionId="user-actions-description"
							icon={ShieldCheck}
							title={t(`titles.${mode}`)}
							description={
								<>
									{t("descriptionPrefix")}{" "}
									<span className="font-mono font-bold text-[#0A3D62]">{farmId}</span>
									{isPlatformAdmin && mode !== "revoke" ? t("currentAdminSuffix") : ""}
								</>
							}
							onClose={close}
							closeDisabled={isPending}
							closeLabel={t("closeLabel")}
						/>

						<div className="mt-4 flex flex-wrap gap-1.5">
							{disabled ? (
								<ActionButton
									active={mode === "enable"}
									onClick={() => open("enable")}
									icon={<Undo2 className="h-3.5 w-3.5" aria-hidden="true" />}
									label={t("buttons.enable")}
								/>
							) : (
								<>
									<ActionButton
										active={mode === "grant"}
										onClick={() => open("grant")}
										icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
										label={t("buttons.grant")}
									/>
									<ActionButton
										active={mode === "reset"}
										onClick={() => open("reset")}
										icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
										label={t("buttons.reset")}
									/>
									<ActionButton
										active={mode === "revoke"}
										onClick={() => open("revoke")}
										icon={<ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />}
										label={t("buttons.revoke")}
									/>
									<ActionButton
										active={mode === "disable"}
										onClick={() => open("disable")}
										icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
										label={t("buttons.disable")}
										danger
									/>
								</>
							)}
						</div>

						{mode === "disable" && (
							<p className="mt-3 text-[11px] font-bold leading-snug text-[#C42B3A]">
								{t("disableWarning")}
							</p>
						)}
						{mode === "enable" && (
							<p className="mt-3 text-[11px] font-bold leading-snug text-[#1E7B34]">
								{t("enableWarning")}
							</p>
						)}
						{mode === "reset" && (
							<p className="mt-3 text-[11px] font-bold leading-snug text-[#8A3B12] dark:text-[#FFB38F]">
								{t("resetWarning")}
							</p>
						)}

						<form onSubmit={submit} className="mt-3 space-y-3">
							<div className="space-y-1.5">
								<label htmlFor={`reason-${farmId}`} className={FIELD_LABEL}>
									{tCommon("reasonRequired")}
								</label>
								<textarea
									id={`reason-${farmId}`}
									value={reason}
									onChange={(e) => setReason(e.target.value)}
									rows={3}
									placeholder={t("reasonPlaceholder")}
									data-autofocus
									aria-describedby={`reason-help-${farmId}`}
									className="w-full resize-none rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2 text-xs text-[#0A3D62] transition-all focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
								/>
								<p id={`reason-help-${farmId}`} className={FIELD_HINT}>
									{tCommon("reasonHelp")}
								</p>
							</div>

							{mode === "disable" && (
								<div className="space-y-1.5">
									<label htmlFor={`confirm-${farmId}`} className={FIELD_LABEL}>
										{t("confirmLabel", { farmId })}
									</label>
									<input
										id={`confirm-${farmId}`}
										value={confirmFarmId}
										onChange={(e) => setConfirmFarmId(e.target.value)}
										autoComplete="off"
										spellCheck={false}
										className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2 font-mono text-xs text-[#0A3D62] transition-all focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
									/>
								</div>
							)}

							{error && (
								<p
									role="alert"
									className="rounded-xl border border-red-200 bg-red-50 p-2 text-[11px] font-bold text-[#C42B3A]"
								>
									{error}
								</p>
							)}

							<div className="flex gap-2">
								<button
									type="submit"
									disabled={isPending}
									className={cn(
										PRIMARY_BUTTON,
										"flex-1 text-xs font-extrabold",
										mode === "disable" && "bg-[#C42B3A] hover:bg-[#a92333]",
									)}
								>
									{isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
									{tCommon("confirm")}
								</button>
								<button
									type="button"
									onClick={close}
									disabled={isPending}
									className={cn(
										SECONDARY_BUTTON,
										"px-3 py-2.5 text-xs font-bold text-[#3D5568] hover:bg-gray-200",
									)}
								>
									{tCommon("cancel")}
								</button>
							</div>
						</form>
					</>
				)}
			</DialogShell>

			<StepUpDialog
				open={stepUpOpen}
				actionLabel={mode ? t(`stepUpActions.${mode}`) : tCommon("continue")}
				onClose={() => setStepUpOpen(false)}
				onVerified={onVerified}
			/>
		</>
	);
}

function ActionButton({
	active,
	onClick,
	icon,
	label,
	danger,
}: {
	active: boolean;
	onClick: () => void;
	icon: React.ReactNode;
	label: string;
	danger?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={cn(
				"inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors",
				FOCUS_RING,
				danger
					? active
						? "border-[#C42B3A] bg-[#C42B3A] text-white"
						: "border-red-200 bg-red-50 text-[#C42B3A] hover:bg-red-100"
					: active
						? "border-[#E85A2A] bg-[#E85A2A] text-white"
						: "border-gray-200 bg-[#F4F7F6] text-[#3D5568] hover:bg-gray-200",
			)}
		>
			{icon}
			{label}
		</button>
	);
}
