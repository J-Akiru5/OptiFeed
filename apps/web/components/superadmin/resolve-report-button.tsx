"use client";

import { SECONDARY_BUTTON } from "@/components/superadmin/ui";
import { useRouter } from "@/i18n/routing";
import { resolveIssueReport } from "@/lib/actions/reports";
import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * Mark one public/assistant issue report resolved (issue #487).
 *
 * Review surface only: the platform-admin guard, the audit row and the
 * idempotency all live in `resolveIssueReport`.
 */
export function ResolveReportButton({ id }: { id: string }) {
	const t = useTranslations("superadmin.operations.reports");
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(false);
	const [done, setDone] = useState(false);

	const run = async () => {
		setPending(true);
		setFailed(false);
		try {
			const result = await resolveIssueReport(id);
			if ("error" in result) {
				setFailed(true);
				return;
			}
			setDone(true);
			router.refresh();
		} catch {
			setFailed(true);
		} finally {
			setPending(false);
		}
	};

	if (done) {
		return (
			<p className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1E7B34] dark:text-emerald-300">
				<Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
				{t("resolvedJustNow")}
			</p>
		);
	}

	return (
		<div className="flex flex-col items-start gap-1">
			<button
				type="button"
				onClick={() => void run()}
				disabled={pending}
				className={SECONDARY_BUTTON}
			>
				{pending ? (
					<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
				) : (
					<Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
				)}
				{pending ? t("resolving") : t("resolve")}
			</button>
			{failed && (
				<p role="alert" className="text-xs font-bold text-[#C42B3A] dark:text-red-300">
					{t("resolveFailed")}
				</p>
			)}
		</div>
	);
}
