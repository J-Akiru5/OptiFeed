"use client";

import { useRouter } from "@/i18n/routing";
import { createUser } from "@/lib/actions/admin";
import { ArrowLeft, CheckCircle, ShieldAlert, UserPlus } from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";

export default function SignupPage() {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const [farmId, setFarmId] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [role, setRole] = useState<"ADMIN" | "OPERATOR" | "VIEWER">("OPERATOR");
	const [password, setPassword] = useState("");

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (!farmId.trim()) {
			setError("Farm ID is required.");
			return;
		}
		if (!displayName.trim()) {
			setError("Display name is required.");
			return;
		}
		if (password.length < 4) {
			setError("Password must be at least 4 characters.");
			return;
		}

		startTransition(async () => {
			const result = await createUser({
				farmId,
				displayName,
				role,
				password,
			});

			if ("error" in result) {
				setError(result.error);
			} else {
				setSuccess(true);
			}
		});
	};

	return (
		<div className="min-h-screen bg-[#F4F7F6] text-[#0A3D62] font-sans flex flex-col justify-between selection:bg-[#E85A2A] selection:text-white">
			{/* Header */}
			<header className="py-4 px-6 md:px-12 bg-white border-b border-gray-200 flex items-center justify-between shadow-sm shrink-0">
				<button
					type="button"
					onClick={() => router.push("/login")}
					className="text-[#3D5568] hover:text-[#0A3D62] flex items-center gap-1.5 font-bold text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
				>
					<ArrowLeft className="w-4 h-4" /> Back to Login
				</button>
				<div className="flex items-center gap-2">
					<div className="w-6 h-6 rounded-lg bg-[#0A3D62] flex items-center justify-center text-white font-black text-sm">
						O
					</div>
					<span className="font-black text-base tracking-tight text-[#0A3D62]">OptiFeed</span>
				</div>
			</header>

			{/* Main */}
			<main className="flex-1 flex items-center justify-center px-4 py-8 md:py-16">
				<div className="w-full max-w-md bg-white rounded-3xl border border-gray-200 shadow-xl overflow-hidden flex flex-col">
					{/* Top banner */}
					<div className="bg-[#0A3D62] text-white p-6 md:p-8 text-center relative overflow-hidden">
						<div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full translate-x-8 -translate-y-8" />
						<UserPlus className="w-10 h-10 mx-auto text-[#E85A2A] mb-3" />
						<h1 className="text-xl md:text-2xl font-black tracking-tight">Create Account</h1>
						<p className="text-xs text-blue-100 mt-1.5 uppercase tracking-widest font-mono">
							Admin Only
						</p>
					</div>

					{/* Form */}
					<form
						onSubmit={handleSubmit}
						className="p-6 md:p-8 flex-1 flex flex-col justify-between gap-5"
					>
						<div className="space-y-4">
							<div className="space-y-1.5">
								<label
									htmlFor="farmId"
									className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
								>
									Farm ID
								</label>
								<input
									id="farmId"
									type="text"
									value={farmId}
									onChange={(e) =>
										setFarmId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
									}
									className="w-full px-4 py-3.5 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all"
									placeholder="e.g. farm-01"
									// biome-ignore lint/a11y/noAutofocus: Autofocus is desired for quick account creation
									autoFocus
								/>
							</div>

							<div className="space-y-1.5">
								<label
									htmlFor="displayName"
									className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
								>
									Display Name
								</label>
								<input
									id="displayName"
									type="text"
									value={displayName}
									onChange={(e) => setDisplayName(e.target.value)}
									className="w-full px-4 py-3.5 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all"
									placeholder="e.g. Juan Miguel"
								/>
							</div>

							<div className="space-y-1.5">
								<label
									htmlFor="role"
									className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
								>
									Role
								</label>
								<select
									id="role"
									value={role}
									onChange={(e) => setRole(e.target.value as typeof role)}
									className="w-full px-4 py-3.5 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all"
								>
									<option value="OPERATOR">Operator</option>
									<option value="ADMIN">Admin</option>
									<option value="VIEWER">Viewer</option>
								</select>
							</div>

							<div className="space-y-1.5">
								<label
									htmlFor="password"
									className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
								>
									PIN / Password
								</label>
								<input
									id="password"
									type="password"
									inputMode="numeric"
									pattern="[0-9]*"
									maxLength={6}
									value={password}
									onChange={(e) => setPassword(e.target.value.replace(/\D/g, ""))}
									className="w-full px-4 py-3.5 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl font-mono text-center text-lg tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all"
									placeholder="••••"
								/>
								<span className="block text-[11px] text-center text-[#3D5568] font-mono">
									4-6 digit PIN
								</span>
							</div>

							{error && (
								<div className="bg-red-50 text-[#C42B3A] text-xs p-3 rounded-xl border border-red-200 flex items-start gap-2">
									<ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
									<div>
										<span className="font-bold">Error: </span> {error}
									</div>
								</div>
							)}

							{success && (
								<div className="bg-green-50 text-green-700 text-xs p-3 rounded-xl border border-green-200 flex items-center gap-2">
									<CheckCircle className="w-4 h-4 shrink-0" />
									<span className="font-bold">Account created! You can now log in.</span>
								</div>
							)}
						</div>

						<div className="mt-2">
							<button
								type="submit"
								disabled={isPending || success}
								className={`w-full bg-[#E85A2A] text-white font-extrabold text-base md:text-lg py-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 transform active:scale-95 ${
									isPending || success
										? "opacity-75 cursor-not-allowed"
										: "hover:bg-[#d04a1f] hover:shadow-lg"
								}`}
							>
								{isPending ? (
									<>
										<span className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
										Creating...
									</>
								) : success ? (
									"Account Created!"
								) : (
									"Create Account"
								)}
							</button>
						</div>
					</form>
				</div>
			</main>

			{/* Footer */}
			<footer className="py-4 px-6 text-center text-xs text-[#3D5568] bg-white border-t border-gray-200 shrink-0">
				OptiFeed Admin — Create User Account
			</footer>
		</div>
	);
}
