"use client";

import {
	dashboardButtonPrimary,
	dashboardField,
	dashboardLabel,
} from "@/components/dashboard/dashboard-classes";
import { useRouter } from "@/i18n/routing";
import { renameFarm } from "@/lib/actions/farm";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useState } from "react";

interface FarmRenameFormProps {
	initialName: string;
	canWrite?: boolean;
}

export function FarmRenameForm({ initialName, canWrite = true }: FarmRenameFormProps) {
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
		<form
			action={handleSubmit}
			data-help="settings-farm-name"
			className="mt-4 space-y-3 border-t border-gray-100 pt-4 dark:border-gray-700/60"
		>
			{error && (
				<div
					role="alert"
					aria-live="assertive"
					className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-[#C42B3A] dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"
				>
					{error}
				</div>
			)}

			<div>
				<label htmlFor="farmName" className={dashboardLabel}>
					{t("farmNameLabel")}
				</label>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
					<input
						id="farmName"
						name="farmName"
						type="text"
						minLength={2}
						maxLength={60}
						required
						disabled={!canWrite}
						value={name}
						onChange={(e) => setName(e.target.value)}
						className={cn(dashboardField, "sm:flex-1")}
					/>
					<button
						type="submit"
						disabled={loading || !canWrite}
						className={cn(dashboardButtonPrimary, "sm:shrink-0")}
					>
						{loading ? t("saving") : t("saveSettings")}
					</button>
				</div>
			</div>
		</form>
	);
}
