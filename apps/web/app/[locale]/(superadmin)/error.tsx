"use client";

import { useEffect } from "react";

export default function SuperadminError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("[superadmin] render error", error);
	}, [error]);

	return (
		<div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
			<h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
				The platform console hit an error
			</h2>
			<p className="max-w-md text-sm text-gray-500 dark:text-gray-400">
				Nothing was changed. Retry the page. If this persists, check the platform audit log and
				Vercel function logs for the matching digest.
			</p>
			<button
				type="button"
				onClick={reset}
				className="rounded-xl bg-[#E85A2A] px-5 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
			>
				Try again
			</button>
		</div>
	);
}
