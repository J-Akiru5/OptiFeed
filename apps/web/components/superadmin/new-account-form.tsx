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
import { type FormEvent, useState, useTransition } from "react";

type Kind = "ADMIN" | "ORG_FARMER" | "INDEPENDENT_FARMER";

const KIND_COPY: Record<Kind, { title: string; blurb: string; needsOrg: boolean }> = {
	ADMIN: {
		title: "Tenant Admin",
		blurb:
			"Manages only their own organization's members and ponds. Gets OWNER membership in the selected org. No farmer functions of its own.",
		needsOrg: true,
	},
	ORG_FARMER: {
		title: "Organization Farmer",
		blurb:
			"OPERATOR membership in the selected org. The org must already have at least one other member.",
		needsOrg: true,
	},
	INDEPENDENT_FARMER: {
		title: "Independent Farmer",
		blurb:
			"Registered into a brand-new single-person organization of type INDIVIDUAL, which they own.",
		needsOrg: false,
	},
};

export function NewAccountForm({
	orgs,
}: {
	orgs: { id: string; name: string; type: string }[];
}) {
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
	const [feedingRatePct, setFeedingRatePct] = useState("3");
	const [feedsPerDay, setFeedsPerDay] = useState("3");
	const [population, setPopulation] = useState("");

	const copy = KIND_COPY[kind];
	const isFarmer = kind !== "ADMIN";
	const passwordsMatch = password === confirmPassword;

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (!farmId.trim()) return setError("Login ID is required.");
		if (!displayName.trim()) return setError("Display name is required.");
		if (!password) return setError("Password is required.");
		if (!passwordsMatch) return setError("Passwords do not match.");
		const passwordCheck = validatePassword(password, "temporary");
		if (!passwordCheck.ok) return setError(passwordErrorMessage(passwordCheck.code));
		if (copy.needsOrg && !orgId) return setError("Select an organization.");
		if (isFarmer && !pondName.trim()) return setError("An initial pond is required.");
		if (reason.trim().length < 10) return setError("Reason must be at least 10 characters.");

		startTransition(async () => {
			try {
				const result = await createPlatformUser({
					reason: reason.trim(),
					farmId,
					displayName,
					password,
					kind,
					orgId: copy.needsOrg ? orgId : undefined,
					pond: isFarmer
						? {
								name: pondName.trim(),
								feedingRatePct: Number(feedingRatePct),
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
				setError(e instanceof Error ? e.message : "Failed to create the account.");
			}
		});
	};

	return (
		<div className="mx-auto max-w-xl space-y-6">
			<button
				type="button"
				onClick={() => router.push("/superadmin/users")}
				className={cn(
					"flex items-center gap-2 rounded text-sm font-bold text-[#3D5568] transition-colors hover:text-[#0A3D62]",
					FOCUS_RING,
				)}
			>
				<ArrowLeft className="h-4 w-4" aria-hidden="true" />
				Back to Users
			</button>

			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">New Account</h1>
				<p className="mt-1 text-sm text-[#3D5568]">
					Three account kinds, one flow. The login ID doubles as the pond email local part.
				</p>
			</div>

			<form onSubmit={handleSubmit} className="space-y-6" aria-busy={isPending}>
				<fieldset className={cn(CARD, "space-y-4 p-6")}>
					<legend className="text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568]">
						Account kind *
					</legend>
					{/* Real radios: arrow keys move between kinds and the checked state
					    is announced, which a row of toggle buttons never was. */}
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
						{(Object.keys(KIND_COPY) as Kind[]).map((k) => (
							<label
								key={k}
								className={cn(
									"cursor-pointer rounded-xl border p-3 text-left transition-all has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#E85A2A] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
									kind === k
										? "border-[#E85A2A] bg-[#E85A2A]/5 shadow-sm"
										: "border-gray-200 bg-[#F4F7F6] hover:border-gray-300",
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
								<span className="block text-xs font-black text-[#0A3D62]">
									{KIND_COPY[k].title}
								</span>
							</label>
						))}
					</div>
					<p className="text-[11px] leading-relaxed text-[#3D5568]">{copy.blurb}</p>
				</fieldset>

				<div className={cn(CARD, "space-y-5 p-6")}>
					<TextField
						id="farmId"
						label="Login ID *"
						value={farmId}
						onChange={(v) => setFarmId(v.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
						placeholder="e.g. juan-dela-cruz"
						hint="Lowercase alphanumeric + hyphens. Used as the login ID."
						disabled={isPending}
					/>
					<TextField
						id="displayName"
						label="Display Name *"
						value={displayName}
						onChange={setDisplayName}
						placeholder="e.g. Juan Miguel"
						disabled={isPending}
					/>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-1.5">
							<label htmlFor="password" className={FIELD_LABEL}>
								Password *
							</label>
							<PasswordInput
								id="password"
								value={password}
								onChange={setPassword}
								placeholder="Temporary password"
								disabled={isPending}
								required
							/>
							<PasswordStrength password={password} />
							{password && getPasswordStrength(password) === "weak" && (
								<p className="text-[11px] font-bold text-[#B45309]">
									Weak temporary password — the user must change it on first login.
								</p>
							)}
						</div>
						<div className="space-y-1.5">
							<label htmlFor="confirmPassword" className={FIELD_LABEL}>
								Confirm password *
							</label>
							<PasswordInput
								id="confirmPassword"
								value={confirmPassword}
								onChange={setConfirmPassword}
								placeholder="Repeat the password"
								disabled={isPending}
								required
							/>
							{confirmPassword && !passwordsMatch && (
								<p id="confirm-mismatch" className="text-[11px] font-bold text-[#C42B3A]">
									Passwords do not match.
								</p>
							)}
						</div>
					</div>

					{copy.needsOrg && (
						<div className="space-y-1.5">
							<label htmlFor="orgId" className={FIELD_LABEL}>
								Organization *
							</label>
							{orgs.length === 0 ? (
								<p className="text-xs font-bold text-[#C42B3A]">
									No organizations exist yet. Create one from the Organizations page first.
								</p>
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
						<legend className="text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568]">
							Initial pond *
						</legend>
						<p className="-mt-1 text-[11px] text-[#3D5568]">
							A farmer with no pond has nothing to work with, so this is required.
						</p>
						<TextField
							id="pondName"
							label="Pond Name *"
							value={pondName}
							onChange={setPondName}
							placeholder="e.g. POND-01"
							disabled={isPending}
						/>
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
							<TextField
								id="feedingRatePct"
								label="Feed % *"
								value={feedingRatePct}
								onChange={(v) => setFeedingRatePct(v.replace(/[^\d.]/g, ""))}
								disabled={isPending}
							/>
							<TextField
								id="feedsPerDay"
								label="Feeds/Day *"
								value={feedsPerDay}
								onChange={(v) => setFeedsPerDay(v.replace(/\D/g, ""))}
								disabled={isPending}
							/>
							<TextField
								id="population"
								label="Population"
								value={population}
								onChange={(v) => setPopulation(v.replace(/\D/g, ""))}
								placeholder="Optional"
								disabled={isPending}
							/>
						</div>
					</fieldset>
				)}

				<div className={cn(CARD, "space-y-1.5 p-6")}>
					<label htmlFor="reason" className={FIELD_LABEL}>
						Reason *
					</label>
					<textarea
						id="reason"
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						rows={3}
						disabled={isPending}
						placeholder="e.g. Onboarded partner farm for Q4 rollout"
						aria-describedby="reason-hint"
						className="w-full resize-none rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3 text-sm text-[#0A3D62] transition-all focus:outline-none focus:ring-2 focus:ring-[#E85A2A] disabled:opacity-60"
					/>
					<p id="reason-hint" className={FIELD_HINT}>
						Recorded in the platform audit log. At least 10 characters.
					</p>
				</div>

				{error && <Alert tone="error">{error}</Alert>}

				{success && <Alert tone="success">Account created.</Alert>}

				<button
					type="submit"
					disabled={isPending || success}
					className={cn(PRIMARY_BUTTON, "w-full py-3.5 text-sm font-extrabold")}
				>
					{isPending ? (
						<>
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
							Creating...
						</>
					) : (
						"Create Account"
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
