"use client";

import { useRouter } from "@/i18n/routing";
import { renameFarm } from "@/lib/actions/farm";
import { useTranslations } from "next-intl";
import { useState } from "react";

interface FarmRenameFormProps {
	initialName: string;
}

export function FarmRenameForm({ initialName }: FarmRenameFormProps) {
	const router = useRouter();
	const t = useTranslations("dashboard.settings");
	const [name, setName] = useState(initialName);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function handleSubmit(formData: FormData) {
		setLoading(true);
		setError(null);

		const result = await renameFarm((formData.get("farmName") as string) ?? "");

		setLoading(false);

		if ("error" in result) {
			setError(result.error);
			return;
		}

		router.refresh();
	}

	return (
		<form action={handleSubmit} className="mt-6 space-y-3 border-t border-gray-100 pt-6">
			{error && (
				<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-[#C42B3A]">
					{error}
				</div>
			)}

			<div className="flex flex-col gap-2">
				<label htmlFor="farmName" className="text-sm font-medium text-gray-700">
					{t("farmNameLabel")}
				</label>
				<div className="flex flex-wrap items-center gap-3">
					<input
						id="farmName"
						name="farmName"
						type="text"
						minLength={2}
						maxLength={60}
						required
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="min-w-[240px] flex-1 rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
					/>
					<button
						type="submit"
						disabled={loading}
						className="min-h-[var(--ofd-touch-min)] rounded-lg bg-[var(--ofd-action)] px-6 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
					>
						{loading ? "…" : t("saveSettings")}
					</button>
				</div>
			</div>
		</form>
	);
}
