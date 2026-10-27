"use client";

import { adminButtonPrimary, adminField, adminLabel } from "@/components/admin/admin-classes";
import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import { useRouter } from "@/i18n/routing";
import { deleteTenantPond } from "@/lib/actions/ponds";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState } from "react";

/**
 * Typed-confirmation delete for an empty pond (#202).
 *
 * The server refuses a mismatched name, any pond with history, and a missing
 * step-up. On `step_up_required` the shared dialog re-authenticates and then
 * retries the exact same call.
 */
export function DeletePondForm({ pondId, pondName }: { pondId: string; pondName: string }) {
	const t = useTranslations("dashboard.adminPondDelete");
	const router = useRouter();
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [stepUpOpen, setStepUpOpen] = useState(false);
	const retryRef = useRef<(() => void) | null>(null);

	const matches = name.trim() === pondName;

	async function run() {
		setPending(true);
		setError(null);
		try {
			const result = await deleteTenantPond({ pondId, confirmName: name });
			if ("error" in result) {
				if (result.code === "step_up_required") {
					retryRef.current = () => {
						void run();
					};
					setStepUpOpen(true);
					return;
				}
				setError(result.error);
				return;
			}
			router.push("/admin/ponds");
			router.refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : t("errorGeneric"));
		} finally {
			setPending(false);
		}
	}

	function onSubmit(event: FormEvent) {
		event.preventDefault();
		if (!matches) {
			setError(t("mismatch"));
			return;
		}
		void run();
	}

	return (
		<>
			<form onSubmit={onSubmit} className="space-y-4">
				<div>
					<label htmlFor="delete-pond-name" className={adminLabel}>
						{t("confirmLabel", { name: pondName })}
					</label>
					<input
						id="delete-pond-name"
						name="pondName"
						value={name}
						onChange={(event) => setName(event.target.value)}
						autoComplete="off"
						disabled={pending}
						placeholder={t("confirmPlaceholder")}
						className={adminField}
						aria-describedby="delete-pond-hint"
					/>
					<p
						id="delete-pond-hint"
						className="mt-1 block text-[11px] text-[#3D5568] dark:text-gray-400"
					>
						{t("confirmHint")}
					</p>
				</div>

				{error && (
					<div
						role="alert"
						className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-[#C42B3A] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
					>
						{error}
					</div>
				)}

				<button
					type="submit"
					disabled={pending || !matches}
					aria-busy={pending}
					className={adminButtonPrimary}
				>
					{pending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
					{pending ? t("submitting") : t("submit")}
				</button>
			</form>

			<StepUpDialog
				open={stepUpOpen}
				actionLabel={t("actionLabel")}
				onClose={() => setStepUpOpen(false)}
				onVerified={() => {
					setStepUpOpen(false);
					retryRef.current?.();
				}}
			/>
		</>
	);
}
