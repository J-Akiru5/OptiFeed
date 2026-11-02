import { Badge, CARD } from "@/components/superadmin/ui";
import type { BandState, StatusBand } from "@/lib/platform/status-band-rules";
import { cn } from "@/lib/utils";
import {
	AlertTriangle,
	CheckCircle2,
	HelpCircle,
	type LucideIcon,
	OctagonAlert,
} from "lucide-react";

/**
 * The four status bands on the Platform Command Center (issue #479, M3C.2).
 *
 * Presentational only: the states are computed on the server in
 * `lib/platform/status-bands.ts`, and every string arrives as a prop from the
 * page's `superadmin.statusBands` translator. That keeps this file free of
 * database work and of any threshold of its own, and — because it is
 * synchronous — the overview page still renders under `renderToStaticMarkup`.
 *
 * Status is never carried by colour alone (T26): each band shows an icon and the
 * state word, and each rule line repeats its state for a screen reader.
 */

const TONE: Record<BandState, "success" | "warning" | "danger" | "neutral"> = {
	ok: "success",
	degraded: "warning",
	critical: "danger",
	unknown: "neutral",
};

const ICON: Record<BandState, LucideIcon> = {
	ok: CheckCircle2,
	degraded: AlertTriangle,
	critical: OctagonAlert,
	unknown: HelpCircle,
};

const ICON_TONE: Record<BandState, string> = {
	ok: "text-[#1E7B34] dark:text-emerald-300",
	degraded: "text-[#B45309] dark:text-amber-300",
	critical: "text-[#C42B3A] dark:text-red-300",
	unknown: "text-[#3D5568] dark:text-slate-400",
};

export function StatusBands({
	bands,
	checkedAtLabel,
	t,
}: {
	bands: readonly StatusBand[];
	/** Pre-formatted by the page with the `dates` catalogue. */
	checkedAtLabel: string;
	t: (key: string, values?: Record<string, string | number>) => string;
}) {
	const format = (value: number | null): string =>
		value === null
			? t("notReported")
			: new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);

	return (
		<section aria-label={t("sectionLabel")} className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="text-lg font-black text-[#0A3D62] dark:text-slate-100">
					{t("sectionLabel")}
				</h2>
				<p className="text-[11px] font-bold text-[#3D5568] dark:text-slate-400">{checkedAtLabel}</p>
			</div>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{bands.map((band) => {
					const Icon = ICON[band.state];
					return (
						<article key={band.key} className={cn(CARD, "flex flex-col gap-3 p-5")}>
							<div className="flex items-start justify-between gap-2">
								<h3 className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400 dark:text-slate-300">
									{t(`bands.${band.key}`)}
								</h3>
								<Badge tone={TONE[band.state]} icon={Icon}>
									{t(`states.${band.state}`)}
								</Badge>
							</div>

							<ul className="space-y-1.5">
								{band.facts.map((fact) => {
									const FactIcon = ICON[fact.state];
									return (
										<li
											key={fact.key}
											className="flex items-start gap-1.5 text-[11px] leading-snug text-[#3D5568] dark:text-slate-400"
										>
											<FactIcon
												className={cn("mt-0.5 h-3 w-3 shrink-0", ICON_TONE[fact.state])}
												aria-hidden="true"
											/>
											<span>
												{t(`facts.${fact.key}`, {
													value: format(fact.value),
													threshold: format(fact.threshold),
												})}
												<span className="sr-only"> — {t(`states.${fact.state}`)}</span>
											</span>
										</li>
									);
								})}
							</ul>
						</article>
					);
				})}
			</div>
		</section>
	);
}
