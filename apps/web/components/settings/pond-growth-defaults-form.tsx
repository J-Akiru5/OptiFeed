"use client";

import { useRouter } from "@/i18n/routing";
import { savePondGrowthDefaults } from "@/lib/actions/growth-defaults";
import {
	GROWTH_DEFAULT_BOUNDS,
	type GrowthDefaultField,
	type GrowthDefaults,
	type ResolvedGrowthDefaults,
	resolveGrowthDefaults,
} from "@/lib/growth/defaults";
import { Loader2, Sprout } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Per-pond growth-default overrides (#828).
 *
 * Every field is blank by default and blank means "inherit". The helper text
 * names the farm default (or the documented constant) that will be used, so
 * the operator can see which layer is in effect for this pond without leaving
 * the page. The write action is the guarded one; this form only collects text.
 */

const FIELDS: {
	name: GrowthDefaultField;
	label: string;
	step?: string;
	/** The value shown for an inherited field; null means "no default". */
	unit: "days" | "g" | "pct" | "fish";
}[] = [
	{ name: "growOutDays", label: "growOutDaysLabel", unit: "days" },
	{ name: "targetHarvestWeightG", label: "targetWeightLabel", unit: "g" },
	{ name: "expectedSurvivalPct", label: "survivalLabel", unit: "pct" },
	{ name: "stockingAvgWeightG", label: "stockingWeightLabel", step: "0.1", unit: "g" },
	{ name: "densityAdvisoryPerM2", label: "densityLabel", unit: "fish" },
];

function formatValue(value: number, unit: (typeof FIELDS)[number]["unit"]): string {
	switch (unit) {
		case "days":
			return `${value} d`;
		case "pct":
			return `${value} %`;
		case "fish":
			return `${value}/m²`;
		default:
			return `${value} g`;
	}
}

export function PondGrowthDefaultsForm({
	pondId,
	override,
	farm,
	canWrite,
}: {
	pondId: string;
	override: GrowthDefaults;
	farm: GrowthDefaults;
	canWrite: boolean;
}) {
	const t = useTranslations("dashboard.settings.growthDefaults");
	const router = useRouter();
	const [values, setValues] = useState<Record<GrowthDefaultField, string>>(() => ({
		growOutDays: override.growOutDays === null ? "" : String(override.growOutDays),
		targetHarvestWeightG:
			override.targetHarvestWeightG === null ? "" : String(override.targetHarvestWeightG),
		expectedSurvivalPct:
			override.expectedSurvivalPct === null ? "" : String(override.expectedSurvivalPct),
		stockingAvgWeightG:
			override.stockingAvgWeightG === null ? "" : String(override.stockingAvgWeightG),
		densityAdvisoryPerM2:
			override.densityAdvisoryPerM2 === null ? "" : String(override.densityAdvisoryPerM2),
	}));
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	const farmResolved: ResolvedGrowthDefaults = resolveGrowthDefaults(farm, null);

	function inheritedHint(field: GrowthDefaultField, unit: (typeof FIELDS)[number]["unit"]): string {
		const resolved = farmResolved[field];
		if (resolved.value === null) return t("inheritsNone");
		return resolved.source === "farm"
			? t("inheritsFarm", { value: formatValue(resolved.value, unit) })
			: t("inheritsSystem", { value: formatValue(resolved.value, unit) });
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		const payload = Object.fromEntries(
			FIELDS.map((field) => {
				const raw = values[field.name];
				return [field.name, raw.trim() === "" ? null : Number(raw)];
			}),
		);
		startTransition(async () => {
			const result = await savePondGrowthDefaults(pondId, payload);
			if (!result.success) {
				setError(result.error);
				toast.error(result.error);
				return;
			}
			toast.success(t("saved"));
			router.refresh();
		});
	}

	return (
		<form
			onSubmit={onSubmit}
			className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900 sm:p-6"
		>
			<div className="mb-4 flex items-start gap-3">
				<span
					aria-hidden="true"
					className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0A3D62]/10 text-[#0A3D62] dark:bg-white/10 dark:text-[#9cc7f0]"
				>
					<Sprout className="h-5 w-5" />
				</span>
				<div>
					<h3 className="text-sm font-black text-[#0A3D62] dark:text-[#8fc0ea]">
						{t("pondTitle")}
					</h3>
					<p className="mt-0.5 text-xs text-[#3D5568] dark:text-gray-400">{t("pondDesc")}</p>
				</div>
			</div>

			{error && (
				<p
					role="alert"
					className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-[#C42B3A] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
				>
					{error}
				</p>
			)}

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				{FIELDS.map((field) => (
					<div key={field.name}>
						<label
							htmlFor={`pond-growth-${field.name}`}
							className="mb-1.5 block text-xs font-black tracking-wide text-[#0A3D62] uppercase dark:text-gray-200"
						>
							{t(field.label)}
						</label>
						<input
							id={`pond-growth-${field.name}`}
							name={field.name}
							type="number"
							min={GROWTH_DEFAULT_BOUNDS[field.name].min}
							max={GROWTH_DEFAULT_BOUNDS[field.name].max}
							step={field.step ?? "1"}
							value={values[field.name]}
							placeholder={t("inheritPlaceholder")}
							disabled={!canWrite || isPending}
							onChange={(event) =>
								setValues((current) => ({ ...current, [field.name]: event.target.value }))
							}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] placeholder:text-gray-400 focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
						<p className="mt-1 text-[11px] text-[#3D5568] dark:text-gray-400">
							{inheritedHint(field.name, field.unit)}
						</p>
					</div>
				))}
			</div>

			<div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<p className="max-w-xl text-[11px] text-[#3D5568] dark:text-gray-400">{t("hint")}</p>
				<button
					type="submit"
					disabled={!canWrite || isPending}
					aria-busy={isPending}
					className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#164e7c] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#1f66a0] dark:hover:bg-[#2a7ab5]"
				>
					{isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
					{isPending ? t("saving") : t("save")}
				</button>
			</div>
		</form>
	);
}
