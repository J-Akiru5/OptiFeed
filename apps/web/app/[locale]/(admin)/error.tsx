"use client";

import { Mascot } from "@/components/assistant/mascot";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

export default function AdminError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const t = useTranslations("dashboard.adminError");
	const tShell = useTranslations("dashboard.adminShell");
	const headingRef = useRef<HTMLHeadingElement>(null);

	useEffect(() => {
		console.error("[admin] render error", error);
		// Move focus to the heading so a screen reader announces the failure
		// instead of leaving the user on a dead control.
		headingRef.current?.focus();
	}, [error]);

	return (
		<div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
			<Mascot pose="powerFault" size={96} />
			<h2
				ref={headingRef}
				tabIndex={-1}
				role="alert"
				className="text-2xl font-bold text-gray-900 focus-visible:outline-none dark:text-gray-100"
			>
				{t("title")}
			</h2>
			<p className="max-w-md text-sm text-gray-600 dark:text-gray-400">{t("desc")}</p>
			<div className="flex flex-wrap items-center justify-center gap-3">
				<button
					type="button"
					onClick={reset}
					className="rounded-xl bg-[#C2410C] px-5 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]"
				>
					{t("retry")}
				</button>
				<Link
					href="/dashboard"
					className="rounded-xl border border-[#0A3D62]/20 px-5 py-2.5 text-sm font-bold text-[#0A3D62] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-gray-600 dark:text-[#8fc0ea] dark:focus-visible:outline-[#8fc0ea]"
				>
					{tShell("backToDashboard")}
				</Link>
			</div>
		</div>
	);
}
