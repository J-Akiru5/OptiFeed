"use client";

import {
	CARD,
	FIELD_HINT,
	FIELD_INPUT,
	FIELD_LABEL,
	FOCUS_RING,
	PRIMARY_BUTTON,
} from "@/components/superadmin/ui";
import { useRouter } from "@/i18n/routing";
import { setListPageSize } from "@/lib/actions/platform/settings";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

/**
 * The one app-wide list page size (decision E1, issue #187).
 *
 * Small on purpose: a number, a required reason (the platform audit row needs
 * one) and Save. Every list reads the stored value through
 * `getListPageSize()`, so there is no per-page override to configure.
 */
export function PlatformListSettings({
	initialPageSize,
	min,
	max,
	fallback,
}: {
	initialPageSize: number;
	min: number;
	max: number;
	fallback: number;
}) {
	const t = useTranslations("superadmin.settings");
	const router = useRouter();
	const [value, setValue] = useState(String(initialPageSize));
	const [reason, setReason] = useState("");
	const [pending, setPending] = useState(false);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const parsed = Number.parseInt(value, 10);
		if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
			toast.error(t("invalid", { min, max }));
			return;
		}
		setPending(true);
		try {
			const result = await setListPageSize(parsed, reason);
			if ("error" in result) {
				toast.error(result.error);
				return;
			}
			toast.success(t("saved", { value: result.value }));
			setReason("");
			router.refresh();
		} catch {
			toast.error(t("failed"));
		} finally {
			setPending(false);
		}
	};

	return (
		<section className="space-y-4">
			<div>
				<h2 className="text-lg font-black text-[#0A3D62]">{t("listsTitle")}</h2>
				<p className="mt-1 max-w-3xl text-sm text-[#3D5568]">{t("listsDescription")}</p>
			</div>

			<form
				onSubmit={handleSubmit}
				className={`${CARD} grid gap-4 p-5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end`}
			>
				<label className="block">
					<span className={FIELD_LABEL}>{t("pageSizeLabel")}</span>
					<input
						type="number"
						inputMode="numeric"
						min={min}
						max={max}
						step={1}
						required
						value={value}
						onChange={(event) => setValue(event.target.value)}
						className={`${FIELD_INPUT} mt-1`}
						aria-describedby="platform-page-size-hint"
					/>
					<span id="platform-page-size-hint" className={`${FIELD_HINT} mt-1 block`}>
						{t("pageSizeHint", { min, max, default: fallback })}
					</span>
				</label>

				<label className="block">
					<span className={FIELD_LABEL}>{t("reasonLabel")}</span>
					<input
						type="text"
						required
						minLength={10}
						maxLength={500}
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						placeholder={t("reasonPlaceholder")}
						className={`${FIELD_INPUT} mt-1`}
						aria-describedby="platform-page-size-reason-hint"
					/>
					<span id="platform-page-size-reason-hint" className={`${FIELD_HINT} mt-1 block`}>
						{t("reasonHint")}
					</span>
				</label>

				<button
					type="submit"
					disabled={pending}
					className={`${PRIMARY_BUTTON} ${FOCUS_RING} sm:mb-5`}
				>
					{pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
					{pending ? t("saving") : t("save")}
				</button>
			</form>
		</section>
	);
}
