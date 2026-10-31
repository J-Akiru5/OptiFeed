"use client";

import { Mascot } from "@/components/assistant/mascot";
import { Card, PRIMARY_BUTTON } from "@/components/superadmin/ui";
import { useTranslations } from "next-intl";
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
	const t = useTranslations("superadmin.error");

	useEffect(() => {
		console.error("[superadmin] render error", error);
	}, [error]);

	return (
		<Card className="mx-auto flex max-w-lg flex-col items-center gap-3 p-8 text-center">
			<Mascot pose="powerFault" size={96} />

			<div role="alert" className="space-y-2">
				<h1 className="text-xl font-black text-[#0A3D62]">{t("title")}</h1>
				<p className="text-sm text-[#3D5568]">{t("description")}</p>
			</div>

			{error.digest && (
				<p className="rounded-lg bg-[#F4F7F6] px-2.5 py-1 font-mono text-[10px] text-[#3D5568]">
					{t("reference", { digest: error.digest })}
				</p>
			)}

			<button type="button" onClick={reset} className={PRIMARY_BUTTON}>
				{t("retry")}
			</button>
		</Card>
	);
}
