"use client";

import { useRouter } from "@/i18n/routing";
import { setPondStatus } from "@/lib/actions/admin";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

interface PondStatusToggleProps {
	pondId: string;
	status: string;
}

export function PondStatusToggle({ pondId, status }: PondStatusToggleProps) {
	const t = useTranslations("dashboard.adminPonds");
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const archiving = status === "ACTIVE";

	async function handleClick() {
		setLoading(true);
		setError(null);

		const result = await setPondStatus(pondId, archiving ? "ARCHIVED" : "ACTIVE");

		setLoading(false);

		if ("error" in result) {
			setError(result.error);
			return;
		}

		router.refresh();
	}

	return (
		<div className="flex min-w-0 flex-col items-end gap-1">
			{error && (
				<p aria-live="polite" className="text-[11px] font-black text-[#C42B3A]">
					{error}
				</p>
			)}
			<button
				type="button"
				onClick={handleClick}
				disabled={loading}
				aria-busy={loading}
				className="inline-flex min-w-[5.5rem] items-center justify-center gap-1.5 rounded-xl border border-[#0A3D62]/20 px-3 py-2 text-xs font-black text-[#0A3D62] transition-colors hover:bg-[#F4F7F6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:opacity-60 dark:border-gray-600 dark:text-[#8fc0ea] dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]"
			>
				{loading && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}
				{loading ? t("updating") : archiving ? t("archive") : t("restore")}
			</button>
		</div>
	);
}
