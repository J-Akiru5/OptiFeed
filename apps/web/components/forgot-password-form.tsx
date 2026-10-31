"use client";

import { Link } from "@/i18n/routing";
import { requestPasswordReset } from "@/lib/actions/password-reset";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";

const IDENTIFIER_MAX_LENGTH = 254;

/**
 * "Forgot password?" panel: ask for the account's email, request a Supabase
 * recovery link, then explain honestly what happened. A farm ID is still
 * accepted in the same box for accounts whose administrator has not recorded
 * an email yet (#449).
 *
 * The success message never claims the email was delivered, and an unknown
 * email or farm ID must answer exactly like a known one (anti-enumeration, see
 * lib/actions/password-reset.ts).
 */
export function ForgotPasswordForm() {
	const t = useTranslations("forgotPassword");
	const [identifier, setIdentifier] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [sentTo, setSentTo] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();
	const identifierRef = useRef<HTMLInputElement>(null);

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		setError(null);

		const normalized = identifier.trim();
		if (!normalized) {
			setError(t("errorEmpty"));
			identifierRef.current?.focus();
			return;
		}

		startTransition(async () => {
			const result = await requestPasswordReset(normalized);
			if ("error" in result) {
				if (result.error === "rate_limited") setError(t("errorRateLimited"));
				else if (result.error === "service") setError(t("errorService"));
				else setError(t("errorEmpty"));
				return;
			}
			setSentTo(normalized.toLowerCase());
		});
	};

	if (sentTo) {
		return (
			<div className="space-y-4">
				<output
					aria-live="polite"
					className="flex items-start gap-2.5 rounded-xl border border-green-200 bg-green-50 p-3.5 text-xs leading-5 font-bold text-green-700 dark:border-green-500/25 dark:bg-green-500/10 dark:text-green-300"
				>
					<CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<span>{t("successDesc", { identifier: sentTo })}</span>
				</output>

				<p className="rounded-xl border border-[#E1E8E5] bg-[#F6F8F7] p-3.5 text-xs leading-5 text-[#3D5568] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400">
					{t("fallbackNote")}
				</p>

				<Link
					href="/login"
					className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#0A3D62] transition-colors hover:text-[#E85A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/40 dark:text-[#8EC5EF] dark:hover:text-[#FF8A5C]"
				>
					<ArrowLeft className="size-3.5" aria-hidden="true" />
					{t("backToLogin")}
				</Link>
			</div>
		);
	}

	return (
		<form noValidate onSubmit={handleSubmit} className="space-y-4">
			<div className="space-y-1.5">
				<label
					htmlFor="identifier"
					className="block text-xs font-extrabold tracking-wider text-[#3D5568] uppercase dark:text-slate-400"
				>
					{t("identifierLabel")}
				</label>
				<input
					ref={identifierRef}
					id="identifier"
					name="identifier"
					type="text"
					inputMode="email"
					autoComplete="username"
					autoCapitalize="none"
					autoCorrect="off"
					spellCheck={false}
					maxLength={IDENTIFIER_MAX_LENGTH}
					enterKeyHint="go"
					value={identifier}
					onChange={(event) => {
						setIdentifier(event.target.value);
						if (error) setError(null);
					}}
					aria-invalid={Boolean(error)}
					disabled={isPending}
					placeholder={t("identifierPlaceholder")}
					className="h-11 w-full rounded-lg border border-[#D6DFDB] bg-white px-3.5 text-sm text-[#0A2E47] shadow-[0_1px_2px_rgba(10,46,71,0.03)] outline-none transition-colors placeholder:text-slate-400 hover:border-[#BCC9C4] focus:border-[#E85A2A] focus:ring-4 focus:ring-[#E85A2A]/15 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-[#FF8A5C] dark:focus:ring-[#FF8A5C]/15"
				/>
				<p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
					{t("identifierDesc")}
				</p>
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
						{t("submitting")}
					</>
				) : (
					<>
						<Mail className="size-4" aria-hidden="true" />
						{t("submit")}
					</>
				)}
			</button>

			<Link
				href="/login"
				className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#0A3D62] transition-colors hover:text-[#E85A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/40 dark:text-[#8EC5EF] dark:hover:text-[#FF8A5C]"
			>
				<ArrowLeft className="size-3.5" aria-hidden="true" />
				{t("backToLogin")}
			</Link>
		</form>
	);
}
