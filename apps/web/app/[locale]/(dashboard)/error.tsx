"use client";

import { Mascot } from "@/components/assistant/mascot";
import { RefreshCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

export default function DashboardError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const t = useTranslations("errors");

	useEffect(() => {
		// Log the error to an error reporting service
		console.error("Dashboard caught an error:", error);
	}, [error]);

	return (
		<div
			role="alert"
			className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in duration-500"
		>
			<Mascot pose="powerFault" size={120} className="mb-4" />

			<h2 className="mb-3 text-3xl font-extrabold text-[var(--ofd-base-deep)]">{t("title")}</h2>

			<p className="mb-8 max-w-md text-lg text-gray-700 dark:text-gray-300">{t("desc")}</p>

			<div className="mb-8 w-full max-w-lg overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-left font-mono text-sm text-gray-700 dark:border-gray-700/50 dark:bg-gray-800 dark:text-gray-200">
				{error.message || t("unknown")}
			</div>

			<button
				type="button"
				onClick={() => reset()}
				className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#C2410C] px-6 py-3 font-bold text-white shadow-md transition-all hover:bg-[#9A3412] hover:shadow-lg focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] active:scale-95 dark:focus-visible:outline-[#8fc0ea]"
			>
				<RefreshCcw aria-hidden="true" size={20} />
				{t("tryAgain")}
			</button>
		</div>
	);
}
