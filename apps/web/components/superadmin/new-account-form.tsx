"use client";

import { PasswordInput } from "@/components/password-input";
import { PasswordStrength } from "@/components/password-strength";
import {
	Alert,
	CARD,
	FIELD_HINT,
	FIELD_INPUT,
	FIELD_LABEL,
	FOCUS_RING,
	PRIMARY_BUTTON,
} from "@/components/superadmin/ui";
import { useRouter } from "@/i18n/routing";
import { createPlatformUser } from "@/lib/actions/superadmin";
import { getPasswordStrength, passwordErrorMessage, validatePassword } from "@/lib/auth/password";
import { cn } from "@/lib/utils";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";

type Kind = "ADMIN" | "ORG_FARMER" | "INDEPENDENT_FARMER";

const KINDS: Kind[] = ["ADMIN", "ORG_FARMER", "INDEPENDENT_FARMER"];

/** Which account kinds need an existing organization; the copy lives in the catalogue. */
const NEEDS_ORG: Record<Kind, boolean> = {
	ADMIN: true,
	ORG_FARMER: true,
	INDEPENDENT_FARMER: false,
};

export function NewAccountForm({
	orgs,
}: {
	orgs: { id: string; name: string; type: string }[];
}) {
	const t = useTranslations("superadmin.newAccount");
	const tCommon = useTranslations("superadmin.common");
	const tRoot = useTranslations("superadmin");
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const [kind, setKind] = useState<Kind>("ORG_FARMER");
	const [farmId, setFarmId] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
	const [reason, setReason] = useState("");

	const [pondName, setPondName] = useState("");
	const [feedingRatePct, setFeedingRatePct] = useState("");
	const [feedsPerDay, setFeedsPerDay] = useState("3");
	const [population, setPopulation] = useState("");

	const needsOrg = NEEDS_ORG[kind];
	const kindBlurb = t(`kinds.${kind}.blurb`);
	const isFarmer = kind !== "ADMIN";
	const passwordsMatch = password === confirmPassword;

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (!farmId.trim()) return setError(t("errors.loginRequired"));
		if (!displayName.trim()) return setError(t("errors.displayRequired"));
		if (!password) return setError(t("errors.passwordRequired"));
		if (!passwordsMatch) return setError(t("errors.passwordMismatch"));
		const passwordCheck = validatePassword(password, "temporary");
		if (!passwordCheck.ok) return setError(passwordErrorMessage(passwordCheck.code));
		if (needsOrg && !orgId) return setError(t("errors.orgRequired"));
		if (isFarmer && !pondName.trim()) return setError(t("errors.pondRequired"));
		if (reason.trim().length < 10) {
			return setError(tCommon("reasonMinLength", { count: 10 }));
		}

		startTransition(async () => {
			try {
				const result = await createPlatformUser({
					reason: reason.trim(),
					farmId,
					displayName,
					password,
					kind,
					orgId: needsOrg ? orgId : undefined,
					pond: isFarmer
						? {
								name: pondName.trim(),
								feedingRatePct: feedingRatePct.trim() ? Number(feedingRatePct) : undefined,
								feedsPerDay: Number(feedsPerDay),
								population: population ? Number(population) : undefined,
							}
						: undefined,
				});

				if ("error" in result) {
					setError(result.error);
					return;
				}
				setSuccess(true);
				setTimeout(() => router.push("/superadmin/users"), 1200);
			} catch (e) {
				setError(e instanceof Error ? e.message : t("errors.failed"));
			}
		});
	};

	return (
		<div className="mx-auto max-w-xl space-y-6">
			<button
				type="button"
				onClick={() => router.push("/superadmin/users")}
				className={cn(
					"flex items-center gap-2 rounded text-sm font-bold text-[#3D5568] dark:text-slate-400 transition-colors hover:text-[#0A3D62]",
					FOCUS_RING,
				)}
			>
				<ArrowLeft className="h-4 w-4" aria-hidden="true" />
				{t("back")}
			</button>

			<div>
				<h1 className="text-2xl font-black text-[#0A3D62] dark:text-slate-100">{t("title")}</h1>
				<p className="mt-1 text-sm text-[#3D5568] dark:text-slate-400">{t("description")}</p>
			</div>

			<form onSubmit={handleSubmit} className="space-y-6" aria-busy={isPending}>
				<fieldset className={cn(CARD, "space-y-4 p-6")}>
					<legend className="text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568] dark:text-slate-400">
						{t("kindLegend")}
					</legend>
					{/* Real radios: arrow keys move between kinds and the checked state
					    is announced, which a row of toggle buttons never was. */}
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
						{KINDS.map((k) => (
							<label
								key={k}
								className={cn(
									"cursor-pointer rounded-xl border p-3 text-left transition-all has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#E85A2A] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
									kind === k
										? "border-[#E85A2A] bg-[#E85A2A]/5 shadow-sm"
										: "border-gray-200 dark:border-[#24304A] bg-[#F4F7F6] dark:bg-[#0B1220] hover:border-gray-300",
								)}
							>
								<input
									type="radio"
									name="kind"
									value={k}
									checked={kind === k}
									onChange={() => setKind(k)}
									disabled={isPending}
									className="sr-only"
								/>
								<span className="block text-xs font-black text-[#0A3D62] dark:text-slate-100">
									{t(`kinds.${k}.title`)}
								</span>
							</label>
						))}
					</div>
					<p className="text-[11px] leading-relaxed text-[#3D5568] dark:text-slate-400">
						{kindBlurb}
					</p>
				</fieldset>

				<div className={cn(CARD, "space-y-5 p-6")}>
					<TextField
						id="farmId"
						label={t("loginId")}
						value={farmId}
						onChange={(v) => setFarmId(v.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
						placeholder={t("loginIdPlaceholder")}
						hint={t("loginIdHint")}
						disabled={isPending}
					/>
					<TextField
						id="displayName"
						label={t("displayName")}
						value={displayName}
						onChange={setDisplayName}
						placeholder={t("displayNamePlaceholder")}
						disabled={isPending}
					/>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-1.5">
							<label htmlFor="password" className={FIELD_LABEL}>
								{t("password")}
							</label>
							<PasswordInput
								id="password"
								value={password}
								onChange={setPassword}
								placeholder={t("passwordPlaceholder")}
								disabled={isPending}
								required
							/>
							<PasswordStrength password={password} />
							{password && getPasswordStrength(password) === "weak" && (
								<p className="text-[11px] font-bold text-[#B45309] dark:text-amber-300">
									{t("weak")}
								</p>
							)}
						</div>
						<div className="space-y-1.5">
							<label htmlFor="confirmPassword" className={FIELD_LABEL}>
								{t("confirmPassword")}
							</label>
							<PasswordInput
								id="confirmPassword"
								value={confirmPassword}
								onChange={setConfirmPassword}
								placeholder={t("confirmPlaceholder")}
								disabled={isPending}
								required
							/>
							{confirmPassword && !passwordsMatch && (
								<p
									id="confirm-mismatch"
									className="text-[11px] font-bold text-[#C42B3A] dark:text-red-300"
								>
									{t("passwordMismatch")}
								</p>
							)}
						</div>
					</div>

					{needsOrg && (
						<div className="space-y-1.5">
							<label htmlFor="orgId" className={FIELD_LABEL}>
								{t("organization")}
							</label>
							{orgs.length === 0 ? (
								<p className="text-xs font-bold text-[#C42B3A] dark:text-red-300">{t("noOrgs")}</p>
							) : (
								<select
									id="orgId"
									value={orgId}
									onChange={(e) => setOrgId(e.target.value)}
									disabled={isPending}
									className={cn(FIELD_INPUT, "font-bold")}
								>
									{orgs.map((o) => (
										<option key={o.id} value={o.id}>
											{o.name} ({o.type})
										</option>
									))}
								</select>
							)}
						</div>
					)}
				</div>

				{isFarmer && (
					<fieldset className={cn(CARD, "space-y-5 p-6")}>
						<legend className="text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568] dark:text-slate-400">
							{t("initialPond")}
						</legend>
						<p className="-mt-1 text-[11px] text-[#3D5568] dark:text-slate-400">
							{t("initialPondDesc")}
						</p>
						<TextField
							id="pondName"
							label={t("pondName")}
							value={pondName}
							onChange={setPondName}
							placeholder={t("pondNamePlaceholder")}
							disabled={isPending}
						/>
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
							<TextField
								id="feedingRatePct"
								label={t("feedPct")}
								value={feedingRatePct}
								onChange={(v) => setFeedingRatePct(v.replace(/[^\d.]/g, ""))}
								placeholder={t("orgDefaultRate")}
								disabled={isPending}
							/>
							<TextField
								id="feedsPerDay"
								label={t("feedsPerDay")}
								value={feedsPerDay}
								onChange={(v) => setFeedsPerDay(v.replace(/\D/g, ""))}
								disabled={isPending}
							/>
							<TextField
								id="population"
								label={t("population")}
								value={population}
								onChange={(v) => setPopulation(v.replace(/\D/g, ""))}
								placeholder={t("optional")}
								disabled={isPending}
							/>
						</div>
					</fieldset>
				)}

				<div className={cn(CARD, "space-y-1.5 p-6")}>
					<label htmlFor="reason" className={FIELD_LABEL}>
						{tCommon("reasonRequired")}
					</label>
					<textarea
						id="reason"
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						rows={3}
						disabled={isPending}
						placeholder={t("reasonPlaceholder")}
						aria-describedby="reason-hint"
						className="w-full resize-none rounded-xl border border-gray-200 dark:border-[#24304A] bg-[#F4F7F6] dark:bg-[#0B1220] px-4 py-3 text-sm text-[#0A3D62] dark:text-slate-100 transition-all focus:outline-none focus:ring-2 focus:ring-[#E85A2A] disabled:opacity-60"
					/>
					<p id="reason-hint" className={FIELD_HINT}>
						{t("reasonHint")}
					</p>
				</div>

				{error && <Alert tone="error">{error}</Alert>}

				{success && <Alert tone="success">{t("created")}</Alert>}

				<button
					type="submit"
					disabled={isPending || success}
					className={cn(PRIMARY_BUTTON, "w-full py-3.5 text-sm font-extrabold")}
				>
					{isPending ? (
						<>
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
							{t("creating")}
						</>
					) : (
						t("submit")
					)}
				</button>
			</form>
		</div>
	);
}

function TextField({
	id,
	label,
	value,
	onChange,
	placeholder,
	hint,
	disabled,
	type = "text",
}: {
	id: string;
	label: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	hint?: string;
	disabled?: boolean;
	type?: string;
}) {
	return (
		<div className="space-y-1.5">
			<label htmlFor={id} className={FIELD_LABEL}>
				{label}
			</label>
			<input
				id={id}
				type={type}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				disabled={disabled}
				aria-describedby={hint ? `${id}-hint` : undefined}
				className={FIELD_INPUT}
			/>
			{hint && (
				<p id={`${id}-hint`} className={FIELD_HINT}>
					{hint}
				</p>
			)}
		</div>
	);
}
