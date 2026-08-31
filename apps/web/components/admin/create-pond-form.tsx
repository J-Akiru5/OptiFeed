"use client";

import { useRouter } from "@/i18n/routing";
import { createPond } from "@/lib/actions/admin";
import { useState } from "react";

interface CreatePondFormProps {
	users: { farmId: string; displayName: string | null }[];
}

export function CreatePondForm({ users }: CreatePondFormProps) {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function handleSubmit(formData: FormData) {
		setLoading(true);
		setError(null);

		const result = await createPond({
			name: formData.get("name") as string,
			ownerFarmId: formData.get("ownerFarmId") as string,
			feedingRatePct: Number.parseFloat(formData.get("feedingRatePct") as string),
			feedsPerDay: Number.parseInt(formData.get("feedsPerDay") as string, 10),
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

			<div>
				<label
					htmlFor="name"
					className="block text-xs font-bold uppercase text-[#3D5568] tracking-wider mb-1.5"
				>
					Pond Name
				</label>
				<input
					id="name"
					name="name"
					required
					placeholder="e.g. ILO-POND-02"
					className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
				/>
			</div>

			<div>
				<label
					htmlFor="ownerFarmId"
					className="block text-xs font-bold uppercase text-[#3D5568] tracking-wider mb-1.5"
				>
					Owner
				</label>
				<select
					id="ownerFarmId"
					name="ownerFarmId"
					required
					className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
				>
					{users.map((user) => (
						<option key={user.farmId} value={user.farmId}>
							{user.displayName || user.farmId} ({user.farmId})
						</option>
					))}
				</select>
			</div>

			<div className="grid grid-cols-2 gap-4">
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
				{loading ? "Creating..." : "Create Pond"}
			</button>
		</form>
	);
}
