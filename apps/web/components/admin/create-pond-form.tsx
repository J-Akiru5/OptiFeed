"use client";

import { PasswordInput } from "@/components/password-input";
import { PasswordStrength } from "@/components/password-strength";
import { useRouter } from "@/i18n/routing";
import { createPondWithFarmer } from "@/lib/actions/admin";
import { getPasswordStrength, passwordErrorMessage, validatePassword } from "@/lib/auth/password";
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
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");

	async function handleSubmit(formData: FormData) {
		setError(null);

		if (!password) {
			setError("Password is required.");
			return;
		}
		if (password !== confirmPassword) {
			setError("Passwords do not match.");
			return;
		}
		const passwordCheck = validatePassword(password, "temporary");
		if (!passwordCheck.ok) {
			setError(passwordErrorMessage(passwordCheck.code));
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

	return (
		<form
			action={handleSubmit}
			className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5"
		>
			{error && (
				<div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm font-bold text-[#C42B3A]">
					{error}
				</div>
			)}

			<fieldset className="space-y-5 border-0 p-0 m-0">
				<legend className="block text-xs font-black uppercase text-[#0A3D62] tracking-wider mb-1.5">
					Farmer
				</legend>

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div>
						<label
							htmlFor="farmerName"
							className="block text-xs font-bold uppercase text-[#3D5568] tracking-wider mb-1.5"
						>
							Name
						</label>
						<input
							id="farmerName"
							name="farmerName"
							required
							placeholder="e.g. Juan Miguel"
							className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
						/>
					</div>
					<div>
						<label
							htmlFor="loginId"
							className="block text-xs font-bold uppercase text-[#3D5568] tracking-wider mb-1.5"
						>
							Login ID
						</label>
						<input
							id="loginId"
							name="loginId"
							required
							pattern="[a-z0-9-]+"
							title="Lowercase letters, numbers and hyphens"
							placeholder="e.g. juan-dela-cruz"
							className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-mono font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
						/>
						<p className="text-[11px] text-[#3D5568] mt-1">Used as the login ID and email.</p>
					</div>
				</div>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label
							htmlFor="password"
							className="block text-xs font-bold uppercase text-[#3D5568] tracking-wider mb-1.5"
						>
							Password
						</label>
						<PasswordInput
							id="password"
							name="password"
							value={password}
							onChange={setPassword}
							required
							disabled={loading}
							placeholder="Temporary password"
						/>
						<PasswordStrength password={password} />
						{password && getPasswordStrength(password) === "weak" && (
							<p className="mt-1.5 text-[11px] font-bold text-[#B54708]">
								Weak temporary password — the user must change it on first login.
							</p>
						)}
					</div>
					<div>
						<label
							htmlFor="confirmPassword"
							className="block text-xs font-bold uppercase text-[#3D5568] tracking-wider mb-1.5"
						>
							Confirm password
						</label>
						<PasswordInput
							id="confirmPassword"
							name="confirmPassword"
							value={confirmPassword}
							onChange={setConfirmPassword}
							required
							disabled={loading}
							placeholder="Repeat the password"
						/>
						{confirmPassword && password !== confirmPassword && (
							<p className="mt-1.5 text-[11px] font-bold text-[#C42B3A]">Passwords do not match.</p>
						)}
					</div>
				</div>
			</fieldset>

			<div>
				<label
					htmlFor="pondName"
					className="block text-xs font-bold uppercase text-[#3D5568] tracking-wider mb-1.5"
				>
					Pond Name
				</label>
				<input
					id="pondName"
					name="pondName"
					required
					placeholder="e.g. ILO-POND-02"
					className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
				/>
			</div>

			<div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
				<div>
					<label
						htmlFor="feedingRatePct"
						className="block text-xs font-bold uppercase text-[#3D5568] tracking-wider mb-1.5"
					>
						Feeding Rate (%)
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
						className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
					/>
				</div>
				<div>
					<label
						htmlFor="feedsPerDay"
						className="block text-xs font-bold uppercase text-[#3D5568] tracking-wider mb-1.5"
					>
						Feeds Per Day
					</label>
					<input
						id="feedsPerDay"
						name="feedsPerDay"
						type="number"
						min="1"
						max="10"
						defaultValue="3"
						required
						className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
					/>
				</div>
				<div>
					<label
						htmlFor="population"
						className="block text-xs font-bold uppercase text-[#3D5568] tracking-wider mb-1.5"
					>
						Population
					</label>
					<input
						id="population"
						name="population"
						type="number"
						min="0"
						placeholder="Optional"
						className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
					/>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-4">
				<div>
					<label
						htmlFor="scheduleStart"
						className="block text-xs font-bold uppercase text-[#3D5568] tracking-wider mb-1.5"
					>
						Schedule Start
					</label>
					<input
						id="scheduleStart"
						name="scheduleStart"
						type="time"
						defaultValue="06:00"
						required
						className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
					/>
				</div>
				<div>
					<label
						htmlFor="scheduleEnd"
						className="block text-xs font-bold uppercase text-[#3D5568] tracking-wider mb-1.5"
					>
						Schedule End
					</label>
					<input
						id="scheduleEnd"
						name="scheduleEnd"
						type="time"
						defaultValue="18:00"
						required
						className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
					/>
				</div>
			</div>

			<button
				type="submit"
				disabled={loading}
				className="w-full rounded-xl bg-[#E85A2A] px-4 py-3 text-sm font-black text-white hover:bg-[#d04a1f] transition-colors disabled:opacity-50"
			>
				{loading ? "Creating..." : "Create Farmer & Pond"}
			</button>
		</form>
	);
}
