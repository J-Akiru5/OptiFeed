"use client";

import { AlertTriangle, RefreshCcw } from "lucide-react";
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
		<div className="flex h-[70vh] flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in duration-500">
			<div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-red-200 bg-red-100 text-red-600 shadow-sm dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-400">
				<AlertTriangle size={40} />
			</div>

			<h2 className="mb-3 text-3xl font-extrabold text-[var(--ofd-base-deep)]">{t("title")}</h2>

			<p className="mb-8 max-w-md text-lg text-gray-600 dark:text-gray-300">{t("desc")}</p>

			<div className="mb-8 w-full max-w-lg overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-left font-mono text-sm text-gray-700 dark:border-gray-700/50 dark:bg-gray-800 dark:text-gray-200">
				{error.message || t("unknown")}
			</div>

			<button
				type="button"
				onClick={() => reset()}
				className="flex items-center gap-2 rounded-xl bg-[var(--ofd-action)] px-6 py-3 font-bold text-white shadow-md transition-all hover:bg-orange-600 hover:shadow-lg active:scale-95"
			>
				<RefreshCcw size={20} />
				{t("tryAgain")}
			</button>
		</div>
	);
}
