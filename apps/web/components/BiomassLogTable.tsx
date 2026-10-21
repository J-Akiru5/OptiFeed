"use client";

import { formatDateTimeLocal } from "@/lib/date-local";
import { Fish, Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

export interface BiomassLogEntry {
	id: string;
	recordedAt: Date;
	sampleWeightKg: number;
	sampleLengthCm: number;
	sampleCount: number;
	avgWeightKg: number;
	batchLabel: string | null;
	source: string | null;
	fishSamples: { id: string; weightGrams: number; lengthCm: number }[];
}

const UNLABELED = "__unlabeled__";
const COLUMN_COUNT = 7;

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

function sourceBadge(t: (key: string) => string, source: string | null) {
	if (source === "import") {
		return (
			<span className="inline-flex items-center px-2 py-0.5 bg-violet-100 text-violet-700 text-[10px] font-bold rounded-full">
				{t("importedBadge")}
			</span>
		);
	}
	if (source === "seed") {
		return (
			<span className="inline-flex items-center px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full">
				{t("seedBadge")}
			</span>
		);
	}
	return null;
}

export function BiomassLogTable({ logs }: { logs: BiomassLogEntry[] }) {
	const t = useTranslations("dashboard.growth");
	const tDates = useTranslations("dates");
	const [batchFilter, setBatchFilter] = useState("");
	const [dateQuery, setDateQuery] = useState("");

	const batchOptions = useMemo(() => {
		const labels = new Set<string>();
		let hasUnlabeled = false;
		for (const log of logs) {
			if (log.batchLabel) labels.add(log.batchLabel);
			else hasUnlabeled = true;
		}
		return { labels: [...labels].sort(), hasUnlabeled };
	}, [logs]);

	const rows = useMemo(() => {
		const q = dateQuery.trim().toLowerCase();
		const filtered = logs.filter((log) => {
			const matchesBatch =
				batchFilter === "" ||
				(batchFilter === UNLABELED ? log.batchLabel === null : log.batchLabel === batchFilter);
			if (!matchesBatch) return false;
			if (!q) return true;
			const d = log.recordedAt;
			const localIso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
			const fmt = formatDateTimeLocal(d, tDates);
			return (
				localIso.includes(q) ||
				fmt.date.toLowerCase().includes(q) ||
				fmt.fullDate.toLowerCase().includes(q)
			);
		});
		return filtered.slice().reverse();
	}, [logs, batchFilter, dateQuery, tDates]);

	return (
		<div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mt-8 xl:mt-0 xl:col-span-2">
			<div className="p-6 border-b border-gray-100 bg-gray-50/50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<h3 className="font-bold text-gray-800">{t("historyTitle")}</h3>
				<div className="flex flex-col sm:flex-row gap-2">
					<select
						aria-label={t("batchFilterLabel")}
						value={batchFilter}
						onChange={(e) => setBatchFilter(e.target.value)}
						className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
					>
						<option value="">{t("allBatches")}</option>
						{batchOptions.hasUnlabeled && <option value={UNLABELED}>{t("unlabeledBatch")}</option>}
						{batchOptions.labels.map((label) => (
							<option key={label} value={label}>
								{label}
							</option>
						))}
					</select>
					<input
						type="text"
						value={dateQuery}
						onChange={(e) => setDateQuery(e.target.value)}
						placeholder={t("searchPlaceholder")}
						className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-[#E85A2A] sm:w-56"
					/>
				</div>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-left text-sm text-gray-600">
					<thead className="bg-gray-50 text-gray-500 uppercase text-xs font-semibold">
						<tr>
							<th className="px-3 py-3 lg:px-4">{t("dateCol")}</th>
							<th className="px-3 py-3 hidden lg:table-cell lg:px-4">{t("batchCol")}</th>
							<th className="px-3 py-3 lg:px-4">{t("totalWeightCol")}</th>
							<th className="px-3 py-3 lg:px-4">{t("fishCountCol")}</th>
							<th className="px-3 py-3 hidden md:table-cell lg:px-4">{t("avgLengthCol")}</th>
							<th className="px-3 py-3 text-right text-[var(--ofd-base-deep)] lg:px-4">
								{t("abwCol")}
							</th>
							<th className="px-3 py-3 text-center lg:px-4">{t("typeCol")}</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-gray-100">
						{rows.map((log) => {
							const srcBadge = sourceBadge(t, log.source);
							return (
								<tr key={log.id} className="hover:bg-gray-50 transition-colors">
									<td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap lg:px-4">
										{formatDateTimeLocal(log.recordedAt, tDates).fullDate}
									</td>
									<td className="px-3 py-3 whitespace-nowrap hidden lg:table-cell lg:px-4">
										{log.batchLabel ?? <span className="text-gray-400">—</span>}
									</td>
									<td className="px-3 py-3 lg:px-4">{log.sampleWeightKg.toFixed(2)}</td>
									<td className="px-3 py-3 lg:px-4">{log.sampleCount}</td>
									<td className="px-3 py-3 hidden md:table-cell lg:px-4">
										{log.sampleLengthCm.toFixed(1)}
									</td>
									<td className="px-3 py-3 text-right font-bold text-[var(--ofd-base-deep)] lg:px-4">
										{(log.avgWeightKg * 1000).toFixed(1)}
									</td>
									<td className="px-3 py-3 text-center lg:px-4">
										<div className="flex flex-col items-center gap-1">
											{log.fishSamples.length > 0 ? (
												<details className="inline-block text-left">
													<summary className="inline-flex cursor-pointer list-none items-center gap-1 px-2 py-1 bg-teal-50 text-teal-700 text-xs font-bold rounded-full hover:bg-teal-100 transition-colors">
														<Fish className="w-3 h-3" />
														{log.fishSamples.length} fish
													</summary>
													<div className="mt-2 min-w-[180px] rounded-xl border border-teal-100 bg-teal-50/50 overflow-hidden">
														<div className="flex items-baseline justify-between gap-3 px-3 py-1.5 bg-teal-100/70 text-[10px] font-bold uppercase text-teal-700">
															<span className="truncate">{log.batchLabel ?? "Unlabeled"}</span>
															<span className="font-medium normal-case text-teal-600 shrink-0">
																{formatDateTimeLocal(log.recordedAt, tDates).date}
															</span>
														</div>
														<table className="w-full text-xs text-gray-600">
															<thead>
																<tr className="text-[10px] uppercase text-teal-700">
																	<th className="px-3 py-1.5 text-left font-bold">#</th>
																	<th className="px-3 py-1.5 text-right font-bold">Weight</th>
																	<th className="px-3 py-1.5 text-right font-bold">Length</th>
																</tr>
															</thead>
															<tbody className="divide-y divide-teal-100">
																{log.fishSamples.map((sample, sampleIndex) => (
																	<tr key={sample.id}>
																		<td className="px-3 py-1.5 text-gray-500">{sampleIndex + 1}</td>
																		<td className="px-3 py-1.5 text-right font-medium text-gray-800">
																			{sample.weightGrams.toFixed(1)} g
																		</td>
																		<td className="px-3 py-1.5 text-right">
																			{sample.lengthCm > 0
																				? `${sample.lengthCm.toFixed(1)} cm`
																				: "—"}
																		</td>
																	</tr>
																))}
															</tbody>
														</table>
													</div>
												</details>
											) : (
												<span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-500 text-xs font-bold rounded-full">
													<Scale className="w-3 h-3" />
													Avg
												</span>
											)}
											{srcBadge}
										</div>
									</td>
								</tr>
							);
						})}
						{rows.length === 0 && (
							<tr>
								<td colSpan={COLUMN_COUNT} className="px-6 py-10 text-center text-gray-500">
									{logs.length === 0 ? t("noSamples") : t("noFilteredSamples")}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}
