"use client";

import {
	DashboardCard,
	DashboardCardList,
	DashboardCardRow,
	DashboardTHead,
	DashboardTable,
	DashboardTd,
	DashboardTh,
	DashboardTr,
} from "@/components/dashboard/dashboard-table";
import { Pagination } from "@/components/ui/pagination";
import { formatFarmDateTime } from "@/lib/date-local";
import { useTranslations } from "next-intl";

export interface CalibrationHistoryRow {
	id: string;
	createdAt: Date;
	kind: "RATE_TEST" | "TARGET_CHECK";
	attempt: number;
	targetGrams: number | null;
	measuredGrams: number;
	errorPct: number | null;
	gramsPerSecondBefore: number;
	gramsPerSecondAfter: number | null;
	accepted: boolean;
	createdByName: string | null;
}

export interface CalibrationSessionSummary {
	sessionId: string;
	attempts: number;
	finalErrorPct: number | null;
	lastAt: Date;
}

interface CalibrationHistoryProps {
	rows: CalibrationHistoryRow[];
	sessions: CalibrationSessionSummary[];
	total: number;
	page: number;
	pageCount: number;
	pageSize: number;
	/** Query kept on the page links, e.g. the selected device and tab (#403). */
	paginationParams?: Record<string, string>;
}

function formatRate(rate: number | null): string {
	if (rate === null || !Number.isFinite(rate) || rate <= 0) return "—";
	return String(Number(rate.toFixed(2)));
}

function formatPercent(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return "—";
	return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatGrams(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return "—";
	return `${String(Number(value.toFixed(1)))} g`;
}

export function CalibrationHistory({
	rows,
	sessions,
	total,
	page,
	pageCount,
	pageSize,
	paginationParams = {},
}: CalibrationHistoryProps) {
	const t = useTranslations("dashboard.appSettings.calibration.history");
	const tDates = useTranslations("dates");

	const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
	const lastRow = Math.min(page * pageSize, total);

	const kindLabel = (kind: CalibrationHistoryRow["kind"]) =>
		kind === "TARGET_CHECK" ? t("kind.TARGET_CHECK") : t("kind.RATE_TEST");

	return (
		<div className="space-y-4">
			{sessions.length > 0 && (
				<ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
					{sessions.map((session) => (
						<li
							key={session.sessionId}
							className="rounded-xl border border-[#0A3D62]/10 bg-[#F4F7F6] p-3 dark:border-gray-700 dark:bg-gray-800/60"
						>
							<p className="text-[10px] font-black uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
								{t("sessionDate", {
									date: formatFarmDateTime(session.lastAt, tDates).fullDate,
								})}
							</p>
							<p className="mt-1 text-sm font-bold text-[#0A3D62] dark:text-gray-100">
								{t("sessionSummary", {
									attempts: session.attempts,
									reTests: Math.max(0, session.attempts - 1),
								})}
							</p>
							<p className="text-xs text-gray-600 dark:text-gray-400">
								{t("sessionFinalError", {
									error: formatPercent(session.finalErrorPct),
								})}
							</p>
						</li>
					))}
				</ul>
			)}

			{total === 0 ? (
				<p className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
					{t("empty")}
				</p>
			) : (
				<>
					<DashboardTable caption={t("caption")} minWidth="min-w-[52rem]">
						<DashboardTHead>
							<DashboardTh>{t("columns.date")}</DashboardTh>
							<DashboardTh>{t("columns.kind")}</DashboardTh>
							<DashboardTh align="right">{t("columns.attempt")}</DashboardTh>
							<DashboardTh align="right">{t("columns.target")}</DashboardTh>
							<DashboardTh align="right">{t("columns.measured")}</DashboardTh>
							<DashboardTh align="right">{t("columns.error")}</DashboardTh>
							<DashboardTh align="right">{t("columns.rate")}</DashboardTh>
							<DashboardTh>{t("columns.accepted")}</DashboardTh>
							<DashboardTh>{t("columns.by")}</DashboardTh>
						</DashboardTHead>
						<tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
							{rows.map((row) => (
								<DashboardTr key={row.id}>
									<DashboardTd className="whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
										{formatFarmDateTime(row.createdAt, tDates).fullDate}
									</DashboardTd>
									<DashboardTd className="whitespace-nowrap">{kindLabel(row.kind)}</DashboardTd>
									<DashboardTd className="text-right font-mono">
										{t("attemptValue", { attempt: row.attempt })}
									</DashboardTd>
									<DashboardTd className="text-right">{formatGrams(row.targetGrams)}</DashboardTd>
									<DashboardTd className="text-right">{formatGrams(row.measuredGrams)}</DashboardTd>
									<DashboardTd
										className={`text-right font-bold ${
											row.errorPct !== null && Math.abs(row.errorPct) > 5
												? "text-[#C42B3A] dark:text-red-300"
												: "text-[#1E7B34] dark:text-green-300"
										}`}
									>
										{formatPercent(row.errorPct)}
									</DashboardTd>
									<DashboardTd className="whitespace-nowrap text-right font-mono">
										{t("rateTransition", {
											from: formatRate(row.gramsPerSecondBefore),
											to: formatRate(row.gramsPerSecondAfter),
										})}
									</DashboardTd>
									<DashboardTd>
										<span
											className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
												row.accepted
													? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
													: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
											}`}
										>
											{row.accepted ? t("acceptedYes") : t("acceptedNo")}
										</span>
									</DashboardTd>
									<DashboardTd className="max-w-[10rem] truncate text-xs text-gray-600 dark:text-gray-400">
										{row.createdByName ?? "—"}
									</DashboardTd>
								</DashboardTr>
							))}
						</tbody>
					</DashboardTable>

					<DashboardCardList label={t("caption")} className="p-4">
						{rows.map((row) => (
							<DashboardCard key={row.id}>
								<div className="flex items-start justify-between gap-3">
									<div>
										<p className="text-xs font-black text-[#0A3D62] dark:text-[#5b9bd5]">
											{formatFarmDateTime(row.createdAt, tDates).fullDate}
										</p>
										<p className="mt-0.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
											{kindLabel(row.kind)} · {t("attemptValue", { attempt: row.attempt })}
										</p>
									</div>
									<span
										className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-bold ${
											row.accepted
												? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
												: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
										}`}
									>
										{row.accepted ? t("acceptedYes") : t("acceptedNo")}
									</span>
								</div>
								<div className="mt-2">
									<DashboardCardRow label={t("columns.target")}>
										{formatGrams(row.targetGrams)}
									</DashboardCardRow>
									<DashboardCardRow label={t("columns.measured")}>
										{formatGrams(row.measuredGrams)}
									</DashboardCardRow>
									<DashboardCardRow label={t("columns.error")}>
										{formatPercent(row.errorPct)}
									</DashboardCardRow>
									<DashboardCardRow label={t("columns.rate")}>
										{t("rateTransition", {
											from: formatRate(row.gramsPerSecondBefore),
											to: formatRate(row.gramsPerSecondAfter),
										})}
									</DashboardCardRow>
									<DashboardCardRow label={t("columns.by")}>
										{row.createdByName ?? "—"}
									</DashboardCardRow>
								</div>
							</DashboardCard>
						))}
					</DashboardCardList>

					<Pagination
						basePath="/dashboard/settings/hardware"
						params={paginationParams}
						page={page}
						pageCount={pageCount}
						showing={t("showing", { from: firstRow, to: lastRow, total })}
						previousLabel={t("previous")}
						nextLabel={t("next")}
						label={t("label")}
					/>
				</>
			)}
		</div>
	);
}
