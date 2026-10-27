"use client";

import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import { Alert, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/superadmin/ui";
import { useRouter } from "@/i18n/routing";
import { startViewAs } from "@/lib/actions/platform/impersonation";
import { cn } from "@/lib/utils";
import { Eye, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";

const MIN_REASON = 10;

/**
 * Start a read-only view-as session for one organization (plan M5.1).
 *
 * The reason is mandatory here and re-validated on the server; a fresh step-up
 * is requested when the action answers `step_up_required`, then the action is
 * retried. On success the admin lands on the tenant dashboard with the red
 * banner, and every write is blocked for the session's 30 minutes.
 */
export function ViewAsControl({ orgId, orgName }: { orgId: string; orgName: string }) {
	const t = useTranslations("superadmin.viewAs");
	const tCommon = useTranslations("superadmin.common");
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [stepUpOpen, setStepUpOpen] = useState(false);
	const retryRef = useRef<(() => void) | null>(null);
	const [isPending, startTransition] = useTransition();

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => {
					setOpen(true);
					setReason("");
					setError(null);
				}}
				data-help="superadmin-view-as"
				aria-label={t("viewAria", { orgName })}
				className={SECONDARY_BUTTON}
			>
				<Eye className="h-3.5 w-3.5" aria-hidden="true" />
				{t("button")}
			</button>
		);
	}

	const run = (trimmedReason: string) => {
		startTransition(async () => {
			try {
				const result = await startViewAs({ orgId, reason: trimmedReason });
				if ("error" in result) {
					if (result.code === "step_up_required") {
						retryRef.current = () => run(trimmedReason);
						setStepUpOpen(true);
						return;
					}
					setError(result.error);
					return;
				}
				setOpen(false);
				setReason("");
				router.push("/dashboard");
				router.refresh();
			} catch (err) {
				setError(err instanceof Error ? err.message : t("startFailed"));
			}
		});
	};

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		if (reason.trim().length < MIN_REASON) {
			setError(tCommon("reasonMinLength", { count: MIN_REASON }));
			return;
		}
		run(reason.trim());
	};

	const onVerified = () => {
		setStepUpOpen(false);
		const retry = retryRef.current;
		retryRef.current = null;
		retry?.();
	};

	return (
		<>
			<form onSubmit={submit} className="min-w-[15rem] space-y-2" aria-busy={isPending}>
				<p className="text-[11px] font-bold leading-snug text-[#C42B3A]">
					{t("warning", { orgName })}
				</p>
				<input
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					disabled={isPending}
					placeholder={tCommon("reasonPlaceholderShort")}
					aria-label={t("reasonAria", { orgName })}
					className="w-full rounded-lg border border-gray-200 bg-[#F4F7F6] px-3 py-2 text-xs text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A] disabled:opacity-60"
				/>
				{error && <Alert tone="error">{error}</Alert>}
				<div className="flex gap-2">
					<button
						type="submit"
						disabled={isPending}
						className={cn(PRIMARY_BUTTON, "px-3 py-1.5 text-xs font-black")}
					>
						{isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
						{t("open")}
					</button>
					<button
						type="button"
						onClick={() => setOpen(false)}
						disabled={isPending}
						className={cn(SECONDARY_BUTTON, "px-3 py-1.5")}
					>
						{tCommon("cancel")}
					</button>
				</div>
			</form>

			<StepUpDialog
				open={stepUpOpen}
				actionLabel={t("stepUpAction", { orgName })}
				onClose={() => setStepUpOpen(false)}
				onVerified={onVerified}
			/>
		</>
	);
}
