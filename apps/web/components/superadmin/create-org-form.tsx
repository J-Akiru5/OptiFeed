"use client";

import { createOrg } from "@/lib/actions/superadmin";
import { Loader2, Plus, ShieldAlert } from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";

const ORG_TYPES = ["INDIVIDUAL", "COOPERATIVE", "COMPANY", "LGU", "ACADEMIC"] as const;

type OrgType = (typeof ORG_TYPES)[number];

export function CreateOrgForm() {
	const [isPending, startTransition] = useTransition();
	const [name, setName] = useState("");
	const [type, setType] = useState<OrgType>("INDIVIDUAL");
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (!name.trim()) return setError("Organization name is required.");
		if (reason.trim().length < 10) return setError("Reason must be at least 10 characters.");

		startTransition(async () => {
			const result = await createOrg({ name, type, reason: reason.trim() });
			if ("error" in result) {
				setError(result.error);
				return;
			}
			setSuccess(true);
			setName("");
			setReason("");
			// Caller revalidates via server action; just clear the form state.
			setTimeout(() => setSuccess(false), 2000);
		});
	};

	return (
		<form
			onSubmit={handleSubmit}
			className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4"
		>
			<p className="text-xs uppercase font-extrabold tracking-wider text-[#3D5568]">
				Create organization
			</p>

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div className="space-y-1.5">
					<label
						htmlFor="org-name"
						className="block text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568]"
					>
						Name *
					</label>
					<input
						id="org-name"
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						disabled={isPending}
						placeholder="e.g. San Pablo Fish Farmers Coop"
						className="w-full px-4 py-3 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all disabled:opacity-60"
					/>
				</div>

				<div className="space-y-1.5">
					<label
						htmlFor="org-type"
						className="block text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568]"
					>
						Type *
					</label>
					<select
						id="org-type"
						value={type}
						onChange={(e) => setType(e.target.value as OrgType)}
						disabled={isPending}
						className="w-full px-4 py-3 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all"
					>
						{ORG_TYPES.map((t) => (
							<option key={t} value={t}>
								{t}
							</option>
						))}
					</select>
				</div>
			</div>

			<div className="space-y-1.5">
				<label
					htmlFor="org-reason"
					className="block text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568]"
				>
					Reason *
				</label>
				<input
					id="org-reason"
					type="text"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					disabled={isPending}
					placeholder="e.g. Tenant onboarding for partner cooperative"
					className="w-full px-4 py-3 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all disabled:opacity-60"
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
				<div className="bg-green-50 text-green-700 text-xs p-3 rounded-xl border border-green-200">
					<span className="font-bold">Organization created.</span>
				</div>
			)}

			<button
				type="submit"
				disabled={isPending || success}
				className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#E85A2A] text-white font-bold text-sm rounded-xl hover:bg-[#d04a1f] transition-colors shadow-sm disabled:opacity-60"
			>
				{isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
				Create Organization
			</button>
		</form>
	);
}
