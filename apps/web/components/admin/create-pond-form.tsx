"use client";

import { adminField, adminHint, adminLabel } from "@/components/admin/admin-classes";
import { PasswordInput } from "@/components/password-input";
import { PasswordStrength } from "@/components/password-strength";
import { useRouter } from "@/i18n/routing";
import { createPondWithFarmer } from "@/lib/actions/admin";
import {
	PASSWORD_MAX_BYTES,
	PASSWORD_MIN_LENGTH,
	type PasswordErrorCode,
	getPasswordStrength,
	passwordErrorMessage,
	validatePassword,
} from "@/lib/auth/password";
import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * Creates a farmer and their first pond together.
 *
 * The old version picked an existing user from a dropdown and called createPond;
 * there was no way for a farmer to get an account and a pond in one place, so
 * this is now the single onboarding path. The farmer lands in the calling
 * admin's organization as an OPERATOR.
 */
export function CreatePondForm() {
	const t = useTranslations("dashboard.adminCreatePond");
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");

	/** Translate a password rule failure, falling back to the shared English copy. */
	function passwordMessage(code: PasswordErrorCode): string {
		const key = `passwordError.${code}`;
		if (!t.has(key)) return passwordErrorMessage(code);
		return t(key, { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_BYTES });
	}

	async function handleSubmit(formData: FormData) {
		setError(null);

		if (!password) {
			setError(t("passwordRequired"));
			return;
		}
		if (password !== confirmPassword) {
			setError(t("passwordMismatch"));
			return;
		}
		const passwordCheck = validatePassword(password, "temporary");
		if (!passwordCheck.ok) {
			setError(passwordMessage(passwordCheck.code));
			return;
		}

		setLoading(true);

		const result = await createPondWithFarmer({
			farmerName: formData.get("farmerName") as string,
			loginId: formData.get("loginId") as string,
			password,
			pondName: formData.get("pondName") as string,
			feedingRatePct: Number.parseFloat(formData.get("feedingRatePct") as string),
			feedsPerDay: Number.parseInt(formData.get("feedsPerDay") as string, 10),
			population: formData.get("population")
				? Number.parseInt(formData.get("population") as string, 10)
				: null,
			scheduleStart: formData.get("scheduleStart") as string,
			scheduleEnd: formData.get("scheduleEnd") as string,
		});

		setLoading(false);

		if ("error" in result) {
			setError(result.error);
			return;
		}

		router.push("/admin/ponds");
	}

	const passwordMismatch = Boolean(confirmPassword) && password !== confirmPassword;

	return (
		<form
			action={handleSubmit}
			className="space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700/60 dark:bg-gray-900"
		>
			{error && (
				<div
					role="alert"
					className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-[#C42B3A] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
				>
					{error}
				</div>
			)}

			<fieldset className="m-0 space-y-5 border-0 p-0">
				<legend className="mb-1.5 block text-xs font-black tracking-wider text-[#0A3D62] uppercase dark:text-[#8fc0ea]">
					{t("farmerLegend")}
				</legend>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label htmlFor="farmerName" className={adminLabel}>
							{t("nameLabel")}
						</label>
						<input
							id="farmerName"
							name="farmerName"
							required
							autoComplete="name"
							placeholder={t("namePlaceholder")}
							className={adminField}
						/>
					</div>
					<div>
						<label htmlFor="loginId" className={adminLabel}>
							{t("loginIdLabel")}
						</label>
						<input
							id="loginId"
							name="loginId"
							required
							pattern="[a-z0-9-]+"
							title={t("loginIdPattern")}
							placeholder={t("loginIdPlaceholder")}
							aria-describedby="loginId-hint"
							className={`${adminField} font-mono`}
						/>
						<p id="loginId-hint" className={adminHint}>
							{t("loginIdHint")}
						</p>
					</div>
				</div>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label htmlFor="password" className={adminLabel}>
							{t("passwordLabel")}
						</label>
						<PasswordInput
							id="password"
							name="password"
							value={password}
							onChange={setPassword}
							required
							disabled={loading}
							placeholder={t("passwordPlaceholder")}
						/>
						<PasswordStrength password={password} />
						{password && getPasswordStrength(password) === "weak" && (
							<p className="mt-1.5 text-[11px] font-bold text-[#B54708] dark:text-amber-400">
								{t("weakPassword")}
							</p>
						)}
					</div>
					<div>
						<label htmlFor="confirmPassword" className={adminLabel}>
							{t("confirmLabel")}
						</label>
						<PasswordInput
							id="confirmPassword"
							name="confirmPassword"
							value={confirmPassword}
							onChange={setConfirmPassword}
							required
							disabled={loading}
							placeholder={t("confirmPlaceholder")}
							ariaInvalid={passwordMismatch}
							ariaDescribedBy={passwordMismatch ? "confirmPassword-error" : undefined}
						/>
						{passwordMismatch && (
							<p
								id="confirmPassword-error"
								aria-live="polite"
								className="mt-1.5 text-[11px] font-bold text-[#C42B3A] dark:text-red-300"
							>
								{t("passwordMismatch")}
							</p>
						)}
					</div>
				</div>
			</fieldset>

			<fieldset className="m-0 space-y-5 border-0 p-0">
				<legend className="mb-1.5 block text-xs font-black tracking-wider text-[#0A3D62] uppercase dark:text-[#8fc0ea]">
					{t("pondLegend")}
				</legend>

				<div>
					<label htmlFor="pondName" className={adminLabel}>
						{t("pondNameLabel")}
					</label>
					<input
						id="pondName"
						name="pondName"
						required
						placeholder={t("pondNamePlaceholder")}
						className={adminField}
					/>
				</div>

				<div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
					<div>
						<label htmlFor="feedingRatePct" className={adminLabel}>
							{t("feedingRateLabel")}
						</label>
						<input
							id="feedingRatePct"
							name="feedingRatePct"
							type="number"
							step="0.1"
							min="0"
							max="20"
							defaultValue="3"
							required
							className={adminField}
						/>
					</div>
					<div>
						<label htmlFor="feedsPerDay" className={adminLabel}>
							{t("feedsPerDayLabel")}
						</label>
						<input
							id="feedsPerDay"
							name="feedsPerDay"
							type="number"
							min="1"
							max="10"
							defaultValue="3"
							required
							className={adminField}
						/>
					</div>
					<div>
						<label htmlFor="population" className={adminLabel}>
							{t("populationLabel")}
						</label>
						<input
							id="population"
							name="population"
							type="number"
							min="0"
							placeholder={t("populationPlaceholder")}
							className={adminField}
						/>
					</div>
				</div>

				<div className="grid grid-cols-2 gap-4">
					<div>
						<label htmlFor="scheduleStart" className={adminLabel}>
							{t("scheduleStartLabel")}
						</label>
						<input
							id="scheduleStart"
							name="scheduleStart"
							type="time"
							defaultValue="06:00"
							required
							className={adminField}
						/>
					</div>
					<div>
						<label htmlFor="scheduleEnd" className={adminLabel}>
							{t("scheduleEndLabel")}
						</label>
						<input
							id="scheduleEnd"
							name="scheduleEnd"
							type="time"
							defaultValue="18:00"
							required
							className={adminField}
						/>
					</div>
				</div>
			</fieldset>

			<button
				type="submit"
				disabled={loading}
				aria-busy={loading}
				className="w-full rounded-xl bg-[#C2410C] px-4 py-3 text-sm font-black text-white transition-colors hover:bg-[#9A3412] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:outline-[#8fc0ea]"
			>
				{loading ? t("submitting") : t("submit")}
			</button>
		</form>
	);
}
