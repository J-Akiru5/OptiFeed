"use client";

import { useRouter } from "@/i18n/routing";
import { createUser } from "@/lib/actions/admin";
import { ArrowLeft, CheckCircle, ShieldAlert } from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";

export default function CreateUserPage() {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const [farmId, setFarmId] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [email, setEmail] = useState("");
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
				email: email || undefined,
				role,
				password,
			});

			if ("error" in result) {
				setError(result.error);
			} else {
				setSuccess(true);
				setTimeout(() => router.push("/admin/users"), 1500);
			}
		});
	};

	return (
		<div className="max-w-lg mx-auto space-y-6">
			<button
				type="button"
				onClick={() => router.push("/admin/users")}
				className="flex items-center gap-2 text-sm font-bold text-[#3D5568] hover:text-[#0A3D62] transition-colors"
			>
				<ArrowLeft className="w-4 h-4" />
				Back to Users
			</button>

			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">Create User</h1>
				<p className="text-sm text-[#3D5568] mt-1">
					Add a new user to the system. They will receive a Supabase Auth account.
				</p>
			</div>

			<form
				onSubmit={handleSubmit}
				className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5"
			>
				<div className="space-y-1.5">
					<label
						htmlFor="farmId"
						className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
					>
						Farm ID *
					</label>
					<input
						id="farmId"
						type="text"
						value={farmId}
						onChange={(e) => setFarmId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
						className="w-full px-4 py-3 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all"
						placeholder="e.g. farm-01"
					/>
					<p className="text-[11px] text-[#3D5568]">
						Lowercase alphanumeric + hyphens. Used as login ID.
					</p>
				</div>

				<div className="space-y-1.5">
					<label
						htmlFor="displayName"
						className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
					>
						Display Name *
					</label>
					<input
						id="displayName"
						type="text"
						value={displayName}
						onChange={(e) => setDisplayName(e.target.value)}
						className="w-full px-4 py-3 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all"
						placeholder="e.g. Juan Miguel"
					/>
				</div>

				<div className="space-y-1.5">
					<label
						htmlFor="email"
						className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
					>
						Email (optional)
					</label>
					<input
						id="email"
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						className="w-full px-4 py-3 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all"
						placeholder="Auto-generated if empty"
					/>
				</div>

				<div className="space-y-1.5">
					<label
						htmlFor="role"
						className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
					>
						Role *
					</label>
					<select
						id="role"
						value={role}
						onChange={(e) => setRole(e.target.value as typeof role)}
						className="w-full px-4 py-3 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all"
					>
						<option value="OPERATOR">Operator - Can view and manage pond operations</option>
						<option value="ADMIN">Admin - Full system access</option>
						<option value="VIEWER">Viewer - Read-only access</option>
					</select>
				</div>

				<div className="space-y-1.5">
					<label
						htmlFor="password"
						className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
					>
						Password *
					</label>
					<input
						id="password"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						className="w-full px-4 py-3 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all"
						placeholder="Minimum 4 characters"
					/>
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
						<span className="font-bold">User created successfully!</span>
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
						"Create User"
					)}
				</button>
			</form>
		</div>
	);
}
