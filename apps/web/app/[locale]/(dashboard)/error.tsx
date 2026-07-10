"use client";

import { AlertTriangle, RefreshCcw } from "lucide-react";
import { useEffect } from "react";

export default function DashboardError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		// Log the error to an error reporting service
		console.error("Dashboard caught an error:", error);
	}, [error]);

	return (
		<div className="flex h-[70vh] flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in duration-500">
			<div className="h-20 w-20 rounded-full bg-red-100 flex items-center justify-center text-red-600 mb-6 shadow-sm border border-red-200">
				<AlertTriangle size={40} />
			</div>

			<h2 className="text-3xl font-extrabold text-[var(--ofd-base-deep)] mb-3">
				Something went wrong!
			</h2>

			<p className="text-gray-600 max-w-md mb-8 text-lg">
				We encountered an unexpected error while loading this page. This might be due to a temporary
				database connection issue.
			</p>

			<div className="bg-gray-50 p-4 rounded-xl border border-gray-200 text-left max-w-lg w-full mb-8 overflow-auto text-sm text-gray-700 font-mono">
				{error.message || "Unknown error occurred"}
			</div>

			<button
				type="button"
				onClick={() => reset()}
				className="flex items-center gap-2 px-6 py-3 bg-[var(--ofd-action)] text-white font-bold rounded-xl shadow-md hover:bg-orange-600 hover:shadow-lg transition-all active:scale-95"
			>
				<RefreshCcw size={20} />
				Try again
			</button>
		</div>
	);
}
