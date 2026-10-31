"use client";

import { PasswordInput } from "@/components/password-input";
import { PasswordStrength } from "@/components/password-strength";
import { useRouter } from "@/i18n/routing";
import { completePasswordReset } from "@/lib/actions/password-reset";
import { validatePassword } from "@/lib/auth/password";
import { AlertCircle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";

/**
 * Set a new password from a Supabase recovery session (the email link).
 *
 * Mirrors ChangePasswordForm minus the current-password field: the requester
 * proved control of the recovery link, not the old credential. On success the
 * recovery session is still valid, so the visitor goes straight to the
 * dashboard — the forced-change flag was cleared by the action.
 */
export function ResetPasswordForm() {
	const t = useTranslations("password");
	const tReset = useTranslations("resetPassword");
	const router = useRouter();
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		setError(null);

		if (!validatePassword(newPassword, "permanent").ok) {
			setError(t("weak"));
			return;
		}
		if (newPassword !== confirmPassword) {
			setError(t("mismatch"));
			return;
		}

		startTransition(async () => {
			const result = await completePasswordReset({ newPassword, confirmPassword });

			if ("error" in result) {
				if (result.error === "weak_password") setError(t("weak"));
				else if (result.error === "mismatch") setError(t("mismatch"));
				else if (result.error === "session") setError(tReset("sessionExpired"));
				else setError(t("service"));
				return;
			}

			router.replace("/dashboard");
		});
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div className="space-y-1.5">
				<label
					htmlFor="newPassword"
					className="block text-xs font-extrabold tracking-wider text-[#3D5568] uppercase dark:text-slate-400"
				>
					{t("new")}
				</label>
				<PasswordInput
					id="newPassword"
					value={newPassword}
					onChange={setNewPassword}
					autoComplete="new-password"
					disabled={isPending}
					required
				/>
				<PasswordStrength password={newPassword} />
			</div>

			<div className="space-y-1.5">
				<label
					htmlFor="confirmPassword"
					className="block text-xs font-extrabold tracking-wider text-[#3D5568] uppercase dark:text-slate-400"
				>
					{t("confirm")}
				</label>
				<PasswordInput
					id="confirmPassword"
					value={confirmPassword}
					onChange={setConfirmPassword}
					autoComplete="new-password"
					disabled={isPending}
					required
				/>
			</div>

			{error && (
				<div
					role="alert"
					className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-5 font-bold text-[#C42B3A] dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"
				>
					<AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<span>{error}</span>
				</div>
			)}

			<button
				type="submit"
				disabled={isPending}
				className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-4 py-3 text-sm font-extrabold text-white transition-colors hover:bg-[#9A3412] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:opacity-70 dark:focus-visible:outline-[#8fc0ea]"
			>
				{isPending ? (
					<>
						<Loader2 className="size-4 animate-spin" aria-hidden="true" />
						{t("submit")}
					</>
				) : (
					t("submit")
				)}
			</button>
		</form>
	);
}
