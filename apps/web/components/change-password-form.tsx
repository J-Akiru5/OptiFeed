"use client";

import { PasswordInput } from "@/components/password-input";
import { PasswordStrength } from "@/components/password-strength";
import { useRouter } from "@/i18n/routing";
import { changeOwnPassword } from "@/lib/actions/password";
import { validatePassword } from "@/lib/auth/password";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";

export function ChangePasswordForm({ forced = false }: { forced?: boolean }) {
	const t = useTranslations("password");
	const router = useRouter();
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const [isPending, startTransition] = useTransition();

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		setError(null);
		setSuccess(false);

		if (!currentPassword) {
			setError(t("wrongCurrent"));
			return;
		}
		if (!validatePassword(newPassword, "permanent").ok) {
			setError(t("weak"));
			return;
		}
		if (newPassword !== confirmPassword) {
			setError(t("mismatch"));
			return;
		}
		if (newPassword === currentPassword) {
			setError(t("same"));
			return;
		}

		startTransition(async () => {
			const result = await changeOwnPassword({ currentPassword, newPassword });

			if ("error" in result) {
				if (result.error === "wrong_current") setError(t("wrongCurrent"));
				else if (result.error === "weak_password") setError(t("weak"));
				else if (result.error === "same_password") setError(t("same"));
				else setError(t("service"));
				return;
			}

			if (forced) {
				router.replace(result.redirectTo);
				return;
			}

			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
			setSuccess(true);
		});
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div className="space-y-1.5">
				<label
					htmlFor="currentPassword"
					className="block text-xs font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400"
				>
					{t("current")}
				</label>
				<PasswordInput
					id="currentPassword"
					value={currentPassword}
					onChange={setCurrentPassword}
					autoComplete="current-password"
					disabled={isPending}
					required
				/>
			</div>

			<div className="space-y-1.5">
				<label
					htmlFor="newPassword"
					className="block text-xs font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400"
				>
					{t("new")}
				</label>
				<PasswordInput
					id="newPassword"
					value={newPassword}
					onChange={setNewPassword}
					disabled={isPending}
					required
				/>
				<PasswordStrength password={newPassword} />
			</div>

			<div className="space-y-1.5">
				<label
					htmlFor="confirmPassword"
					className="block text-xs font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400"
				>
					{t("confirm")}
				</label>
				<PasswordInput
					id="confirmPassword"
					value={confirmPassword}
					onChange={setConfirmPassword}
					disabled={isPending}
					required
				/>
			</div>

			{error && (
				<div
					role="alert"
					className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-[#C42B3A] dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"
				>
					<AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<span>{error}</span>
				</div>
			)}

			{success && (
				<div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-xs font-bold text-green-700 dark:border-green-500/25 dark:bg-green-500/10 dark:text-green-300">
					<CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
					<span>{t("updated")}</span>
				</div>
			)}

			<button
				type="submit"
				disabled={isPending}
				className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E85A2A] px-4 py-3 text-sm font-extrabold text-white transition-colors hover:bg-[#d04a1f] disabled:cursor-not-allowed disabled:opacity-70"
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
