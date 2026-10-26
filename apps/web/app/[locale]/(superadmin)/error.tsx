"use client";

import { Card, PRIMARY_BUTTON } from "@/components/superadmin/ui";
import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

/**
 * Console error boundary. It keeps the same card/typography language as the
 * pages and shows the digest so an operator can match the row with the Vercel
 * function logs. Nothing is retried automatically — the admin decides.
 */
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
		<Card className="mx-auto flex max-w-lg flex-col items-center gap-3 p-8 text-center">
			<div
				className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FDE8EA] text-[#C42B3A]"
				aria-hidden="true"
			>
				<AlertTriangle className="h-6 w-6" />
			</div>

			<div role="alert" className="space-y-2">
				<h1 className="text-xl font-black text-[#0A3D62]">The platform console hit an error</h1>
				<p className="text-sm text-[#3D5568]">
					Nothing was changed. Retry the page. If this persists, check the platform audit log and
					Vercel function logs for the matching reference.
				</p>
			</div>

			{error.digest && (
				<p className="rounded-lg bg-[#F4F7F6] px-2.5 py-1 font-mono text-[10px] text-[#3D5568]">
					Reference: {error.digest}
				</p>
			)}

			<button type="button" onClick={reset} className={PRIMARY_BUTTON}>
				Try again
			</button>
		</Card>
	);
}
