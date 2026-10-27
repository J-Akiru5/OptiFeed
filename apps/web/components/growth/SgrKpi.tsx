import type { SgrUnavailableReason } from "@/lib/sgr";
import { TrendingUp } from "lucide-react";

/**
 * Specific Growth Rate KPI (capstone objective).
 *
 * Presentation only: values come from `lib/sgr.ts` on the server. Kept as a
 * component so the KPI can be rendered in a test without booting the whole
 * growth page (Prisma, pond selection, growth plan).
 */

export interface SgrKpiLabels {
	title: string;
	overall: string;
	averageGain: string;
	unit: string;
	explanation: string;
	reasons: Record<SgrUnavailableReason, string>;
}

export interface SgrKpiProps {
	latestSgrPctPerDay: number | null;
	overallSgrPctPerDay: number | null;
	averageDailyGainG: number | null;
	reason: SgrUnavailableReason | null;
	labels: SgrKpiLabels;
}

function sgrTone(value: number | null): string {
	return value !== null && value < 0 ? "text-red-600" : "text-[var(--ofd-base-deep)]";
}

export function SgrKpi({
	latestSgrPctPerDay,
	overallSgrPctPerDay,
	averageDailyGainG,
	reason,
	labels,
}: SgrKpiProps) {
	const reasonText = latestSgrPctPerDay === null && reason ? labels.reasons[reason] : null;

	return (
		<div className="flex flex-col justify-between rounded-3xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
			<div className="mb-4 flex items-start justify-between">
				<div>
					<p className="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
						{labels.title}
					</p>
					<p className={`mt-1 text-4xl font-extrabold ${sgrTone(latestSgrPctPerDay)}`}>
						{latestSgrPctPerDay === null ? "—" : latestSgrPctPerDay.toFixed(2)}
						{latestSgrPctPerDay !== null && (
							<span className="text-lg font-medium text-gray-500 dark:text-gray-400">
								{" "}
								{labels.unit}
							</span>
						)}
					</p>
					<p className="mt-1 text-sm font-medium text-gray-600 dark:text-gray-300">
						{labels.overall}:{" "}
						<span className={`font-bold ${sgrTone(overallSgrPctPerDay)}`}>
							{overallSgrPctPerDay === null
								? "—"
								: `${overallSgrPctPerDay.toFixed(2)} ${labels.unit}`}
						</span>
					</p>
					{averageDailyGainG !== null && (
						<p className="text-sm font-medium text-gray-600 dark:text-gray-300">
							{labels.averageGain}:{" "}
							<span className="font-bold">{averageDailyGainG.toFixed(1)} g/day</span>
						</p>
					)}
					{reasonText && (
						<p className="mt-1 max-w-xs text-xs font-medium text-amber-700 dark:text-amber-400">
							{reasonText}
						</p>
					)}
				</div>
				<div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
					<TrendingUp aria-hidden="true" className="h-7 w-7" />
				</div>
			</div>
			<p className="text-xs text-gray-500 dark:text-gray-400">{labels.explanation}</p>
		</div>
	);
}
