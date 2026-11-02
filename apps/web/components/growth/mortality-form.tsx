"use client";

import { useRouter } from "@/i18n/routing";
import { saveMortalityLog } from "@/lib/actions/mortality";
import { cn } from "@/lib/utils";
import { AlertTriangle, Skull, TrendingDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";

/**
 * Small mortality recorder on the growth page (issue #452: "a small form on
 * the pond page"). The write keeps `Pond.population` untouched; the form shows
 * the derived live count the server returns after saving.
 */
export function MortalityForm({
	pondId,
	canWrite,
	population,
	dead,
	stocked,
	mortalityPct,
}: {
	pondId: string;
	canWrite: boolean;
	population: number | null;
	dead: number;
	stocked: number | null;
	mortalityPct: number | null;
}) {
	const t = useTranslations("dashboard.growth");
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [liveAfter, setLiveAfter] = useState<number | null>(null);
	const formRef = useRef<HTMLFormElement>(null);

	if (!canWrite) return null;

	function submit(formData: Omit<FormData, "pondId">) {
		setError(null);
		startTransition(async () => {
			formData.set("pondId", pondId);
			const result = await saveMortalityLog(formData as FormData);
			if (!result.success) {
				setError(
					result.error === "validation" ? t("mortality.invalidCount") : t("mortality.saveFailed"),
				);
				return;
			}
			setLiveAfter(result.live?.live ?? null);
			formRef.current?.reset();
			router.refresh();
		});
	}

	return (
		<div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50">
			<div className="flex justify-between items-start mb-4">
				<div>
					<p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
						<Skull className="w-4 h-4 text-rose-500" aria-hidden="true" />
						{t("mortality.title")}
					</p>
					<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t("mortality.explain")}</p>
				</div>
				<button
					type="button"
					onClick={() => setOpen((value) => !value)}
					className="shrink-0 inline-flex items-center gap-2 rounded-full bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-200 px-4 py-2 text-sm font-semibold transition-colors"
					aria-expanded={open}
				>
					<TrendingDown className="w-4 h-4" aria-hidden="true" />
					{open ? t("mortality.cancel") : t("mortality.open")}
				</button>
			</div>

			{open && (
				<form
					ref={formRef}
					action={submit}
					className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end"
				>
					<label className="grid gap-1">
						<span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
							{t("mortality.countLabel")}
						</span>
						<input
							name="count"
							type="number"
							min={1}
							max={100000}
							step={1}
							required
							inputMode="numeric"
							className="rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent dark:bg-gray-800 px-3 py-2 text-sm"
						/>
					</label>
					<label className="grid gap-1">
						<span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
							{t("mortality.reasonLabel")}
						</span>
						<input
							name="reason"
							type="text"
							maxLength={200}
							placeholder={t("mortality.reasonPlaceholder")}
							className="rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent dark:bg-gray-800 px-3 py-2 text-sm"
						/>
					</label>
					<button
						type="submit"
						disabled={pending}
						className={cn(
							"justify-self-start sm:justify-self-end inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700",
							"disabled:opacity-50 text-white px-4 py-2.5 text-sm font-semibold transition-colors",
						)}
					>
						{pending ? t("mortality.saving") : t("mortality.save")}
					</button>
				</form>
			)}

			{error && (
				<p className="mt-3 flex items-center gap-2 text-sm text-rose-700 dark:text-rose-300">
					<AlertTriangle className="w-4 h-4" aria-hidden="true" />
					{error}
				</p>
			)}
			{liveAfter !== null && !error && (
				<p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
					{t("mortality.saved", { live: liveAfter })}
				</p>
			)}
			{population !== null && liveAfter === null && (
				<p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
					{mortalityPct !== null
						? t("mortality.currentPopulationWithRate", {
								population,
								dead,
								stocked: stocked ?? population,
								pct: mortalityPct.toFixed(1),
							})
						: t("mortality.currentPopulation", { population })}
				</p>
			)}
		</div>
	);
}
