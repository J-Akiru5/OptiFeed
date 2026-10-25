"use client";

import { PasswordInput } from "@/components/password-input";
import { PasswordStrength } from "@/components/password-strength";
import { useRouter } from "@/i18n/routing";
import { createPlatformUser } from "@/lib/actions/superadmin";
import { getPasswordStrength, passwordErrorMessage, validatePassword } from "@/lib/auth/password";
import { ArrowLeft, CheckCircle, ShieldAlert } from "lucide-react";
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

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (!farmId.trim()) return setError("Login ID is required.");
		if (!displayName.trim()) return setError("Display name is required.");
		if (!password) return setError("Password is required.");
		if (password !== confirmPassword) return setError("Passwords do not match.");
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
		<div className="max-w-xl mx-auto space-y-6">
			<button
				type="button"
				onClick={() => router.push("/superadmin/users")}
				className="flex items-center gap-2 text-sm font-bold text-[#3D5568] hover:text-[#0A3D62] transition-colors"
			>
				<ArrowLeft className="w-4 h-4" />
				Back to Users
			</button>

			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">New Account</h1>
				<p className="text-sm text-[#3D5568] mt-1">
					Three account kinds, one flow. The login ID doubles as the pond email local part.
				</p>
			</div>

			<form onSubmit={handleSubmit} className="space-y-6">
				<fieldset className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
					<legend className="sr-only">Account kind</legend>
					<p className="text-xs uppercase font-extrabold tracking-wider text-[#3D5568]">
						Account kind *
					</p>
					<div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
						{(Object.keys(KIND_COPY) as Kind[]).map((k) => (
							<button
								key={k}
								type="button"
								onClick={() => setKind(k)}
								disabled={isPending}
								className={`p-3 rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A] ${
									kind === k
										? "border-[#E85A2A] bg-[#E85A2A]/5 shadow-sm"
										: "border-gray-200 bg-[#F4F7F6] hover:border-gray-300"
								}`}
							>
								<span className="block text-xs font-black text-[#0A3D62]">
									{KIND_COPY[k].title}
								</span>
							</button>
						))}
					</div>
					<p className="text-[11px] text-[#3D5568] leading-relaxed">{copy.blurb}</p>
				</fieldset>

				<div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
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
							<label
								htmlFor="password"
								className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
							>
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
								<p className="text-[11px] font-bold text-[#B54708]">
									Weak temporary password — the user must change it on first login.
								</p>
							)}
						</div>
						<div className="space-y-1.5">
							<label
								htmlFor="confirmPassword"
								className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
							>
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
							{confirmPassword && password !== confirmPassword && (
								<p className="text-[11px] font-bold text-[#C42B3A]">Passwords do not match.</p>
							)}
						</div>
					</div>

					{copy.needsOrg && (
						<div className="space-y-1.5">
							<label
								htmlFor="orgId"
								className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
							>
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
									className="w-full px-4 py-3 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all"
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
					<div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
						<p className="text-xs uppercase font-extrabold tracking-wider text-[#3D5568]">
							Initial pond *
						</p>
						<p className="text-[11px] text-[#3D5568] -mt-3">
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
						<div className="grid grid-cols-3 gap-3">
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
					</div>
				)}

				<div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-1.5">
					<label
						htmlFor="reason"
						className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
					>
						Reason *
					</label>
					<textarea
						id="reason"
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						rows={3}
						disabled={isPending}
						placeholder="e.g. Onboarded partner farm for Q4 rollout"
						className="w-full px-4 py-3 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all resize-none"
					/>
					<p className="text-[11px] text-[#3D5568]">
						Recorded in the platform audit log. At least 10 characters.
					</p>
				</div>

				{error && (
					<div className="bg-red-50 text-[#C42B3A] text-xs p-3 rounded-xl border border-red-200 flex items-start gap-2">
						<ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
						<span className="font-bold">{error}</span>
					</div>
				)}

				{success && (
					<div className="bg-green-50 text-green-700 text-xs p-3 rounded-xl border border-green-200 flex items-center gap-2">
						<CheckCircle className="w-4 h-4 shrink-0" />
						<span className="font-bold">Account created.</span>
					</div>
				)}

				<button
					type="submit"
					disabled={isPending || success}
					className={`w-full bg-[#E85A2A] text-white font-extrabold text-sm py-3.5 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 ${
						isPending || success
							? "opacity-75 cursor-not-allowed"
							: "hover:bg-[#d04a1f] hover:shadow-lg active:scale-[0.98]"
					}`}
				>
					{isPending ? (
						<>
							<span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
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
			<label
				htmlFor={id}
				className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
			>
				{label}
			</label>
			<input
				id={id}
				type={type}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				disabled={disabled}
				className="w-full px-4 py-3 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all disabled:opacity-60"
			/>
			{hint && <p className="text-[11px] text-[#3D5568]">{hint}</p>}
		</div>
	);
}
