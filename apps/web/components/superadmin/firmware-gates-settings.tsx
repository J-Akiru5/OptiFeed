"use client";

import {
	FIELD_HINT,
	FIELD_INPUT,
	FIELD_LABEL,
	FOCUS_RING,
	PRIMARY_BUTTON,
} from "@/components/superadmin/ui";
import { useRouter } from "@/i18n/routing";
import { setFirmwareGates } from "@/lib/actions/platform/settings";
import {
	FIRMWARE_GATE_FIELDS,
	type FirmwareValues,
	formatFirmwareValue,
	isWithinFirmwareField,
} from "@/lib/firmware/config";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

/**
 * Firmware feed-safety gates (I-100).
 *
 * The seven values the platform admin may move inside the firmware's absolute
 * envelope. The form is generated from `FIRMWARE_GATE_FIELDS`, so a new gate is
 * one entry there plus its two messages. The same bounds are enforced by the
 * server action and again by the firmware itself; this form only gives the
 * reader an inline check first.
 */
export function FirmwareGatesSettings({ initial }: { initial: FirmwareValues }) {
	const t = useTranslations("superadmin.settings.firmwareGates");
	const router = useRouter();
	const [values, setValues] = useState<Record<string, string>>(() =>
		Object.fromEntries(FIRMWARE_GATE_FIELDS.map((field) => [field.id, String(initial[field.id])])),
	);
	const [reason, setReason] = useState("");
	const [pending, setPending] = useState(false);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		const payload: Record<string, number> = {};
		for (const field of FIRMWARE_GATE_FIELDS) {
			const parsed = Number(values[field.id]);
			if (!isWithinFirmwareField(field, parsed)) {
				toast.error(
					t("invalidField", {
						field: t(`fields.${field.id}.label`),
						min: formatFirmwareValue(field.min),
						max: formatFirmwareValue(field.max),
					}),
				);
				return;
			}
			payload[field.id] = parsed;
		}

		setPending(true);
		try {
			const result = await setFirmwareGates(payload, reason);
			if ("error" in result) {
				toast.error(result.error);
				return;
			}
			toast.success(t("saved"));
			setReason("");
			router.refresh();
		} catch {
			toast.error(t("failed"));
		} finally {
			setPending(false);
		}
	};

	return (
		<div className="rounded-2xl border border-gray-200 dark:border-[#24304A] bg-white dark:bg-[#111A2C] p-5 shadow-sm">
			<form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
				{FIRMWARE_GATE_FIELDS.map((field) => (
					<label key={field.id} className="block">
						<span className={FIELD_LABEL}>{t(`fields.${field.id}.label`)}</span>
						<input
							type="number"
							inputMode={field.integer ? "numeric" : "decimal"}
							min={field.min}
							max={field.max}
							step={field.integer ? 1 : "any"}
							required
							value={values[field.id] ?? ""}
							onChange={(event) =>
								setValues((current) => ({ ...current, [field.id]: event.target.value }))
							}
							className={`${FIELD_INPUT} mt-1`}
							aria-describedby={`firmware-${field.id}-hint`}
						/>
						<span id={`firmware-${field.id}-hint`} className={`${FIELD_HINT} mt-1 block`}>
							{t(`fields.${field.id}.hint`, {
								min: formatFirmwareValue(field.min),
								max: formatFirmwareValue(field.max),
							})}
						</span>
					</label>
				))}

				<label className="block md:col-span-2">
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
						aria-describedby="firmware-gates-reason-hint"
					/>
					<span id="firmware-gates-reason-hint" className={`${FIELD_HINT} mt-1 block`}>
						{t("reasonHint")}
					</span>
				</label>

				<div className="flex items-end">
					<button
						type="submit"
						disabled={pending}
						className={`${PRIMARY_BUTTON} ${FOCUS_RING} w-full`}
					>
						{pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
						{pending ? t("saving") : t("save")}
					</button>
				</div>
			</form>
			<p className={`${FIELD_HINT} mt-3`}>{t("note")}</p>
		</div>
	);
}
