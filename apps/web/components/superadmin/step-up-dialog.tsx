"use client";

import { DialogHeader, DialogShell } from "@/components/superadmin/dialog-shell";
import {
	DIALOG_ERROR,
	DIALOG_FIELD,
	DIALOG_LABEL,
	DIALOG_PRIMARY,
	DIALOG_SECONDARY,
} from "@/components/superadmin/dialog-theme";
import { startStepUp } from "@/lib/actions/step-up";
import { cn } from "@/lib/utils";
import { KeyRound, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";

/**
 * Step-up re-authentication dialog (plan M3.3).
 *
 * Shown when a dangerous action answers `step_up_required`: the admin re-enters
 * their own password, `startStepUp` verifies it with Supabase and sets the
 * signed 5-minute cookie, then the caller retries the original action.
 *
 * The password lives in this component's state only. Nothing is stored, and it
 * is cleared as soon as the action resolves. Escape, the close button and the
 * backdrop behaviour all come from DialogShell, which also returns focus to the
 * control that opened the dialog.
 */
export function StepUpDialog({
	open,
	actionLabel,
	onClose,
	onVerified,
}: {
	open: boolean;
	/** What the retry will do, e.g. "rotate the device token". */
	actionLabel: string;
	onClose: () => void;
	onVerified: () => void;
}) {
	const t = useTranslations("superadmin.stepUp");
	const tCommon = useTranslations("superadmin.common");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	const close = () => {
		if (isPending) return;
		setPassword("");
		setError(null);
		onClose();
	};

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		if (!password) {
			setError(t("enterPassword"));
			return;
		}

		startTransition(async () => {
			try {
				const result = await startStepUp(password);
				setPassword("");
				if ("error" in result) {
					setError(result.error);
					return;
				}
				setError(null);
				onVerified();
			} catch (err) {
				setPassword("");
				setError(err instanceof Error ? err.message : t("failed"));
			}
		});
	};

	return (
		<DialogShell
			open={open}
			onClose={close}
			labelledBy="stepup-title"
			describedBy="stepup-description"
			pending={isPending}
		>
			<DialogHeader
				titleId="stepup-title"
				descriptionId="stepup-description"
				icon={KeyRound}
				title={t("title")}
				description={t("description", { action: actionLabel })}
				onClose={close}
				closeDisabled={isPending}
				closeLabel={t("closeLabel")}
			/>

			<form onSubmit={submit} className="mt-4 space-y-3">
				<div className="space-y-1.5">
					<label htmlFor="stepup-password" className={DIALOG_LABEL}>
						{t("password")}
					</label>
					<input
						id="stepup-password"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						disabled={isPending}
						autoComplete="current-password"
						data-autofocus
						aria-invalid={error ? true : undefined}
						aria-describedby={error ? "stepup-error" : undefined}
						className={cn(DIALOG_FIELD, error && "border-[#C42B3A] dark:border-red-400")}
					/>
				</div>

				{error && (
					<p
						id="stepup-error"
						role="alert"
						className={cn("rounded-xl border p-2 text-[11px] font-bold", DIALOG_ERROR)}
					>
						{error}
					</p>
				)}

				<div className="flex gap-2">
					<button
						type="submit"
						disabled={isPending}
						className={cn(DIALOG_PRIMARY, "flex-1 text-xs font-extrabold")}
					>
						{isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
						{tCommon("continue")}
					</button>
					<button
						type="button"
						onClick={close}
						disabled={isPending}
						className={cn(DIALOG_SECONDARY, "px-3 py-2.5 text-xs font-bold")}
					>
						{tCommon("cancel")}
					</button>
				</div>
			</form>
		</DialogShell>
	);
}
