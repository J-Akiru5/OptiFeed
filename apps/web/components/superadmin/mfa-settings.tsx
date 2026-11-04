"use client";

import { useRouter } from "@/i18n/routing";
import {
	type TotpEnrollment,
	beginTotpEnrollment,
	cancelTotpEnrollment,
	confirmTotpEnrollment,
	unenrollTotpFactor,
} from "@/lib/actions/mfa";
import type { TotpFactorSummary } from "@/lib/auth/mfa";
import { cn } from "@/lib/utils";
import { AlertCircle, Check, Copy, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	Badge,
	DANGER_BUTTON,
	FIELD_HINT,
	FIELD_INPUT,
	FIELD_LABEL,
	PRIMARY_BUTTON,
	SECONDARY_BUTTON,
} from "./ui";

/**
 * Optional TOTP management for a platform admin (#719).
 *
 * The secret and QR code exist only in the response of `beginTotpEnrollment()`
 * and in this component's state; they are never persisted by OptiFeed. Active
 * factors are read back from Supabase as metadata only.
 *
 * The card deliberately says the feature is optional. Enforcement is a separate
 * owner decision; shipping a gate now would lock admins out mid-rollout.
 */
export function MfaSettings({ factors }: { factors: TotpFactorSummary[] }) {
	const t = useTranslations("superadmin.account");
	const router = useRouter();

	const verified = factors.filter((factor) => factor.status === "verified");
	const pending = factors.filter((factor) => factor.status === "unverified");

	const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
	const [code, setCode] = useState("");
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [isStarting, startStarting] = useTransition();
	const [isConfirming, startConfirming] = useTransition();

	const [removeId, setRemoveId] = useState<string | null>(null);
	const [removeCode, setRemoveCode] = useState("");
	const [removeError, setRemoveError] = useState<string | null>(null);
	const [isRemoving, startRemoving] = useTransition();
	const [isDiscarding, startDiscarding] = useTransition();

	const messageFor = (error: "invalid" | "not_found" | "service") => {
		if (error === "invalid") return t("mfaErrorCode");
		if (error === "not_found") return t("mfaErrorExpired");
		return t("mfaErrorService");
	};

	const startEnrollment = () => {
		setConfirmError(null);
		setEnrollment(null);
		setCode("");
		setCopied(false);
		startStarting(async () => {
			const result = await beginTotpEnrollment();
			if ("error" in result) {
				setConfirmError(t("mfaErrorService"));
				return;
			}
			setEnrollment(result.enrollment);
		});
	};

	const confirmEnrollment = (event: FormEvent) => {
		event.preventDefault();
		if (!enrollment) return;
		setConfirmError(null);
		startConfirming(async () => {
			const result = await confirmTotpEnrollment(enrollment.factorId, code);
			if ("error" in result) {
				setConfirmError(messageFor(result.error));
				return;
			}
			toast.success(t("mfaEnrolled"));
			setEnrollment(null);
			setCode("");
			router.refresh();
		});
	};

	const removeFactor = (event: FormEvent) => {
		event.preventDefault();
		if (!removeId) return;
		setRemoveError(null);
		startRemoving(async () => {
			const result = await unenrollTotpFactor(removeId, removeCode);
			if ("error" in result) {
				setRemoveError(messageFor(result.error));
				return;
			}
			toast.success(t("mfaRemoved"));
			setRemoveId(null);
			setRemoveCode("");
			router.refresh();
		});
	};

	const discardPending = (factorId: string) => {
		setConfirmError(null);
		startDiscarding(async () => {
			const result = await cancelTotpEnrollment(factorId);
			if ("error" in result) {
				setConfirmError(messageFor(result.error));
				return;
			}
			router.refresh();
		});
	};

	const copySecret = async () => {
		if (!enrollment) return;
		try {
			await navigator.clipboard.writeText(enrollment.secret);
			setCopied(true);
		} catch {
			toast.error(t("mfaCopyFailed"));
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<Badge tone={verified.length > 0 ? "success" : "neutral"} icon={ShieldCheck}>
					{verified.length > 0 ? t("mfaOn") : t("mfaOff")}
				</Badge>
				<span className="text-[11px] text-console-content-muted">{t("mfaOptional")}</span>
			</div>

			{verified.length > 0 && (
				<div>
					<h3 className="text-xs font-extrabold tracking-wider text-console-content-muted uppercase">
						{t("mfaFactors")}
					</h3>
					<ul className="mt-2 divide-y divide-console-border rounded-xl border border-console-border">
						{verified.map((factor) => (
							<li key={factor.id} className="p-3">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<span className="flex items-center gap-2 text-sm font-bold text-console-content">
										<Smartphone className="size-4" aria-hidden="true" />
										{t("mfaFactorLabel")}
										<span className="font-normal text-console-content-muted">
											{t("mfaFactorAdded", { date: factor.createdAt.slice(0, 10) })}
										</span>
									</span>
									<button
										type="button"
										onClick={() => {
											setRemoveId(removeId === factor.id ? null : factor.id);
											setRemoveCode("");
											setRemoveError(null);
										}}
										className={SECONDARY_BUTTON}
										aria-expanded={removeId === factor.id}
									>
										{t("mfaRemove")}
									</button>
								</div>

								{removeId === factor.id && (
									<form onSubmit={removeFactor} className="mt-3 space-y-2">
										<p className={FIELD_HINT}>{t("mfaRemoveHint")}</p>
										<label className={FIELD_LABEL} htmlFor={`remove-code-${factor.id}`}>
											{t("mfaCode")}
										</label>
										<div className="flex flex-wrap gap-2">
											<input
												id={`remove-code-${factor.id}`}
												name="removeCode"
												type="text"
												inputMode="numeric"
												autoComplete="one-time-code"
												autoCapitalize="none"
												autoCorrect="off"
												spellCheck={false}
												maxLength={6}
												pattern="[0-9]*"
												value={removeCode}
												onChange={(event) => setRemoveCode(event.target.value)}
												className={cn(FIELD_INPUT, "max-w-40 text-center tracking-[0.3em]")}
											/>
											<button
												type="submit"
												disabled={isRemoving || removeCode.replace(/\s+/g, "").length !== 6}
												className={DANGER_BUTTON}
											>
												{isRemoving ? (
													<Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
												) : null}
												{t("mfaRemoveSubmit")}
											</button>
										</div>
										{removeError && (
											<p role="alert" className="text-xs font-bold text-console-critical-content">
												{removeError}
											</p>
										)}
									</form>
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			{pending.length > 0 && !enrollment && (
				<div className="rounded-xl border border-console-border bg-console-warn-surface p-3">
					<p className="text-xs font-bold text-console-warn-content">{t("mfaPending")}</p>
					<p className="mt-1 text-[11px] text-console-warn-content">{t("mfaPendingHint")}</p>
					<ul className="mt-2 flex flex-wrap gap-2">
						{pending.map((factor) => (
							<li key={factor.id}>
								<button
									type="button"
									onClick={() => discardPending(factor.id)}
									disabled={isDiscarding}
									className={SECONDARY_BUTTON}
								>
									{t("mfaPendingCancel")}
								</button>
							</li>
						))}
					</ul>
				</div>
			)}

			{enrollment ? (
				<div className="rounded-xl border border-console-border bg-console-surface-sunken p-4">
					<h3 className="font-black text-console-content">{t("mfaSetupTitle")}</h3>
					<p className="mt-1 text-xs text-console-content-muted">{t("mfaSetupDesc")}</p>

					<div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
						{/* The QR is an SVG data URL from Supabase; it carries no script. */}
						<Image
							src={enrollment.qrCodeDataUrl}
							alt={t("mfaQrAlt")}
							width={176}
							height={176}
							unoptimized
							// Scanners need a light quiet zone in both themes; this is
							// the image surface, not a console card.
							className="size-44 shrink-0 rounded-lg bg-white p-2 dark:bg-white"
						/>
						<div className="min-w-0 flex-1 space-y-2">
							<p className={FIELD_LABEL}>{t("mfaSecret")}</p>
							<div className="flex flex-wrap items-center gap-2">
								<code className="rounded-lg border border-console-border bg-console-surface px-2 py-1 font-mono text-xs break-all text-console-content">
									{enrollment.secret}
								</code>
								<button type="button" onClick={copySecret} className={SECONDARY_BUTTON}>
									{copied ? (
										<Check className="size-3.5" aria-hidden="true" />
									) : (
										<Copy className="size-3.5" aria-hidden="true" />
									)}
									{copied ? t("mfaCopied") : t("mfaCopy")}
								</button>
							</div>
							<p className={FIELD_HINT}>{t("mfaSecretHint")}</p>
						</div>
					</div>

					<form onSubmit={confirmEnrollment} className="mt-4 max-w-md space-y-2">
						<label className={FIELD_LABEL} htmlFor="confirm-mfa-code">
							{t("mfaCode")}
						</label>
						<div className="flex flex-wrap gap-2">
							<input
								id="confirm-mfa-code"
								name="code"
								type="text"
								inputMode="numeric"
								autoComplete="one-time-code"
								autoCapitalize="none"
								autoCorrect="off"
								spellCheck={false}
								maxLength={6}
								pattern="[0-9]*"
								value={code}
								onChange={(event) => setCode(event.target.value)}
								className={cn(FIELD_INPUT, "max-w-40 text-center tracking-[0.3em]")}
							/>
							<button
								type="submit"
								disabled={isConfirming || code.replace(/\s+/g, "").length !== 6}
								className={PRIMARY_BUTTON}
							>
								{isConfirming ? (
									<Loader2 className="size-4 animate-spin" aria-hidden="true" />
								) : null}
								{isConfirming ? t("mfaVerifying") : t("mfaVerify")}
							</button>
						</div>
						{confirmError && (
							<p
								role="alert"
								className="flex items-start gap-1.5 text-xs font-bold text-console-critical-content"
							>
								<AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
								{confirmError}
							</p>
						)}
					</form>
				</div>
			) : (
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={startEnrollment}
						disabled={isStarting || isDiscarding}
						className={PRIMARY_BUTTON}
					>
						{isStarting ? (
							<Loader2 className="size-4 animate-spin" aria-hidden="true" />
						) : (
							<Smartphone className="size-4" aria-hidden="true" />
						)}
						{isStarting ? t("mfaPreparing") : t("mfaEnrol")}
					</button>
					{confirmError && (
						<p
							role="alert"
							className="flex items-start gap-1.5 text-xs font-bold text-console-critical-content"
						>
							<AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
							{confirmError}
						</p>
					)}
				</div>
			)}

			<p className="rounded-xl border border-console-border bg-console-surface-sunken p-3 text-[11px] leading-relaxed text-console-content-muted">
				{t("mfaRecovery")}
			</p>
		</div>
	);
}
