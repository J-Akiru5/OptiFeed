"use client";

import {
	adminButtonPrimary,
	adminField,
	adminHint,
	adminLabel,
} from "@/components/admin/admin-classes";
import { useRouter } from "@/i18n/routing";
import {
	type AddTenantDeviceResult,
	type TenantRegistrationOptions,
	addTenantDevice,
} from "@/lib/actions/device-registration";
import { Check, Copy, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

/**
 * "Add feeder" for the tenant console (issue #190).
 *
 * The result depends on the org's device-registration policy: with
 * SELF_REGISTER the token is shown exactly once here; with ADMIN_APPROVAL the
 * unit is created pending and only an org admin can approve it, after which the
 * normal reveal action works. The token is never stored in component state
 * beyond this panel and never logged.
 */

type FormState =
	| { kind: "idle" }
	| { kind: "added"; result: Extract<AddTenantDeviceResult, { success: true }> }
	| { kind: "error"; message: string };

export function AddFeederForm({
	options,
	defaultPondId,
}: {
	options: TenantRegistrationOptions;
	/** Preselect the pond when the form is opened from a pond detail page. */
	defaultPondId?: string;
}) {
	const t = useTranslations("dashboard.adminDevices");
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [state, setState] = useState<FormState>({ kind: "idle" });
	const [copied, setCopied] = useState(false);

	const hasPonds = options.ponds.length > 0;

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const formData = new FormData(form);

		setPending(true);
		setState({ kind: "idle" });
		setCopied(false);
		try {
			const result = await addTenantDevice({
				mac: String(formData.get("mac") ?? ""),
				label: String(formData.get("label") ?? ""),
				pondId: String(formData.get("pondId") ?? ""),
			});
			if ("error" in result) {
				setState({ kind: "error", message: result.error });
				return;
			}
			setState({ kind: "added", result });
			form.reset();
			toast.success(
				result.approvalStatus === "APPROVED" ? t("addSuccess") : t("addPendingSuccess"),
			);
			router.refresh();
		} catch {
			setState({ kind: "error", message: t("addError") });
		} finally {
			setPending(false);
		}
	}

	async function copyToken(token: string) {
		try {
			await navigator.clipboard.writeText(token);
			setCopied(true);
			toast.success(t("copied"));
		} catch {
			toast.error(t("copyFailed"));
		}
	}

	return (
		<section className="rounded-2xl border border-gray-200 bg-[#F4F7F6] p-4 dark:border-gray-700/60 dark:bg-gray-800/60">
			<h2 className="font-black text-[#0A3D62] dark:text-[#8fc0ea]">{t("addFeederTitle")}</h2>
			<p className="mt-1 text-xs text-[#3D5568] dark:text-gray-400">{t("addFeederDesc")}</p>

			{!hasPonds ? (
				<p className="mt-3 text-sm font-bold text-[#3D5568] dark:text-gray-300">
					{t("addFeederNoPonds")}
				</p>
			) : (
				<form
					onSubmit={onSubmit}
					className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-4"
				>
					<div>
						<label htmlFor="add-device-mac" className={adminLabel}>
							{t("addFeederMacLabel")}
						</label>
						<input
							id="add-device-mac"
							name="mac"
							required
							placeholder={t("addFeederMacPlaceholder")}
							autoComplete="off"
							disabled={pending}
							className={`${adminField} font-mono`}
						/>
					</div>
					<div>
						<label htmlFor="add-device-label" className={adminLabel}>
							{t("addFeederLabelLabel")}
						</label>
						<input
							id="add-device-label"
							name="label"
							required
							maxLength={64}
							placeholder={t("addFeederLabelPlaceholder")}
							disabled={pending}
							className={adminField}
						/>
					</div>
					<div>
						<label htmlFor="add-device-pond" className={adminLabel}>
							{t("addFeederPondLabel")}
						</label>
						<select
							id="add-device-pond"
							name="pondId"
							required
							defaultValue={
								defaultPondId && options.ponds.some((pond) => pond.id === defaultPondId)
									? defaultPondId
									: undefined
							}
							disabled={pending}
							className={adminField}
						>
							{options.ponds.map((pond) => (
								<option key={pond.id} value={pond.id}>
									{pond.name}
								</option>
							))}
						</select>
					</div>
					<button
						type="submit"
						disabled={pending}
						aria-busy={pending}
						className={adminButtonPrimary}
					>
						{pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
						{pending ? t("adding") : t("addFeederSubmit")}
					</button>

					<p className={`${adminHint} sm:col-span-2 xl:col-span-4`}>
						{options.mode === "SELF_REGISTER"
							? t("addFeederSelfRegisterHint")
							: t("addFeederApprovalHint")}
					</p>

					{state.kind === "error" && (
						<div
							role="alert"
							className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-[#C42B3A] sm:col-span-2 xl:col-span-4 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
						>
							{state.message}
						</div>
					)}

					{state.kind === "added" && state.result.token && (
						<div className="rounded-xl border border-amber-300 bg-amber-50 p-3 sm:col-span-2 xl:col-span-4 dark:border-amber-700/60 dark:bg-amber-950/30">
							<p className="text-xs font-black tracking-wider text-[#8A4B08] uppercase dark:text-amber-300">
								{t("addFeederTokenTitle")}
							</p>
							<p className="mt-1 text-[11px] font-bold text-[#8A4B08] dark:text-amber-200">
								{t("tokenWarning")}
							</p>
							<div className="mt-2 flex flex-wrap items-center gap-2">
								<code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 font-mono text-xs font-bold text-[#0A3D62] dark:bg-gray-900 dark:text-gray-100">
									{state.result.token}
								</code>
								<button
									type="button"
									onClick={() => copyToken(state.result.token as string)}
									className={adminButtonPrimary}
								>
									{copied ? (
										<Check aria-hidden="true" className="h-4 w-4" />
									) : (
										<Copy aria-hidden="true" className="h-4 w-4" />
									)}
									{copied ? t("copied") : t("copy")}
								</button>
							</div>
						</div>
					)}

					{state.kind === "added" && !state.result.token && (
						<div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-[#0A3D62] sm:col-span-2 xl:col-span-4 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
							{t("addPendingNotice", { mac: state.result.mac })}
						</div>
					)}
				</form>
			)}
		</section>
	);
}
