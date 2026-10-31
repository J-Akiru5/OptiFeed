"use client";

import {
	dashboardButtonPrimary,
	dashboardButtonSecondary,
	dashboardField,
} from "@/components/dashboard/dashboard-classes";
import { importFeedingSchedule } from "@/lib/actions/schedule";
import { ApiClientError, apiPost, apiPostForm } from "@/lib/api-client";
import { buildFilename, downloadCsv } from "@/lib/csv";
import { fetchJobArtifact, waitForJob } from "@/lib/jobs/client";
import type { ScheduleCapCheck } from "@/lib/schedule/sheet";
import { cn } from "@/lib/utils";
import type { PreparedImport } from "@/lib/xlsx/prepare";
import {
	PDF_REPORTS,
	type PdfReport,
	SHEET_TYPES,
	type SheetType,
	TYPE_FIELDS,
} from "@/lib/xlsx/schema";
import { AlertCircle, CheckCircle2, Download, FileText, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

type ExportFormat = "csv" | "xlsx" | "pdf";
type PreparedResponse = PreparedImport & { fileName: string; capCheck: ScheduleCapCheck | null };

function useDataTypes() {
	const t = useTranslations("dashboard.importExport");
	return SHEET_TYPES.map((id) => ({ id, label: t(`types.${id}`) }));
}

function saveBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

export function DataExportButton() {
	const t = useTranslations("dashboard.importExport");
	const dataTypes = useDataTypes();
	const [open, setOpen] = useState(false);
	const [format, setFormat] = useState<ExportFormat>("csv");
	const [report, setReport] = useState<PdfReport>("summary");
	const [selectedTypes, setSelectedTypes] = useState<Set<SheetType>>(new Set());
	const [exporting, setExporting] = useState(false);

	const toggleType = (type: SheetType) => {
		setSelectedTypes((prev) => {
			const next = new Set(prev);
			if (next.has(type)) {
				next.delete(type);
			} else {
				next.add(type);
			}
			return next;
		});
	};

	const selectAll = () => {
		if (selectedTypes.size === dataTypes.length) {
			setSelectedTypes(new Set());
		} else {
			setSelectedTypes(new Set(dataTypes.map((dt) => dt.id)));
		}
	};

	const handleExport = async () => {
		if (format !== "pdf" && selectedTypes.size === 0) return;

		setExporting(true);
		try {
			const types = Array.from(selectedTypes);
			const single = format === "csv" && types.length === 1;
			const date = new Date().toISOString().slice(0, 10);
			const body =
				format === "pdf"
					? { kind: "pdf", report }
					: format === "xlsx"
						? { kind: "xlsx", types }
						: single
							? { kind: "csv", type: types[0] }
							: { kind: "zip", types };
			const job = await apiPost<{ id: string }>("/api/v1/export-jobs", body, { timeoutMs: 5_000 });

			const { downloadUrl } = await waitForJob(job.id);
			if (!downloadUrl) throw new Error(t("exportNotReady"));

			const response = await fetchJobArtifact(downloadUrl);
			if (!response.ok) throw new Error(t("exportDownloadFailed"));

			if (single) {
				downloadCsv(buildFilename(types[0]), await response.text());
				toast.success(t("exportSuccess"));
			} else {
				const extension = format === "csv" ? "zip" : format;
				const name = format === "pdf" ? `pakaonai-${report}-${date}` : `pakaonai_export_${date}`;
				saveBlob(await response.blob(), `${name}.${extension}`);
				toast.success(t("batchExportSuccess"));
			}
			setOpen(false);
			setSelectedTypes(new Set());
		} catch (error) {
			toast.error(error instanceof ApiClientError ? error.message : t("exportError"));
		} finally {
			setExporting(false);
		}
	};

	const downloadLabel =
		format === "pdf"
			? t("downloadPdf")
			: format === "xlsx"
				? t("downloadXlsx")
				: selectedTypes.size > 1
					? t("downloadZip")
					: t("downloadCsv");

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				data-help="export-data"
				className={cn(dashboardButtonPrimary, "w-full sm:w-auto")}
			>
				<Download aria-hidden="true" className="h-4 w-4" /> {t("export")}
			</button>

			{open && (
				<dialog
					open
					aria-modal="true"
					aria-labelledby="export-dialog-title"
					className="fixed inset-0 z-50 m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/50 p-4"
				>
					<div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-gray-900 sm:p-6">
						<div className="mb-6 flex items-center justify-between gap-4">
							<h2
								id="export-dialog-title"
								className="text-lg font-black text-[#0A3D62] dark:text-[#5b9bd5]"
							>
								{t("exportTitle")}
							</h2>
							<button
								type="button"
								onClick={() => setOpen(false)}
								aria-label={t("close")}
								className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-[#3D5568] transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:focus-visible:ring-[#8fc0ea]"
							>
								<X aria-hidden="true" className="h-4 w-4" />
							</button>
						</div>

						<div className="mb-4">
							<label
								htmlFor="export-format"
								className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-300"
							>
								{t("format")}
							</label>
							<select
								id="export-format"
								value={format}
								onChange={(e) => setFormat(e.target.value as ExportFormat)}
								className={dashboardField}
							>
								<option value="csv">{t("formatCsv")}</option>
								<option value="xlsx">{t("formatXlsx")}</option>
								<option value="pdf">{t("formatPdf")}</option>
							</select>
						</div>

						{format === "pdf" ? (
							<div className="mb-6">
								<label
									htmlFor="export-report"
									className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-300"
								>
									{t("reportLabel")}
								</label>
								<select
									id="export-report"
									value={report}
									onChange={(e) => setReport(e.target.value as PdfReport)}
									className={dashboardField}
								>
									{PDF_REPORTS.map((id) => (
										<option key={id} value={id}>
											{t(`reports.${id}`)}
										</option>
									))}
								</select>
								<p className="mt-2 text-xs text-[#3D5568] dark:text-gray-300">{t("pdfNote")}</p>
							</div>
						) : (
							<>
								<div className="mb-4">
									<button
										type="button"
										onClick={selectAll}
										className="inline-flex min-h-11 items-center text-xs font-black text-[#C2410C] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:text-[#ff8a5c] dark:focus-visible:ring-[#8fc0ea]"
									>
										{selectedTypes.size === dataTypes.length ? t("deselectAll") : t("selectAll")}
									</button>
								</div>

								<div className="mb-6 space-y-2">
									{dataTypes.map((dt) => (
										<label
											key={dt.id}
											className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-gray-200 p-3 transition-colors hover:bg-[#F4F7F6] dark:border-gray-700 dark:hover:bg-gray-800"
										>
											<input
												type="checkbox"
												checked={selectedTypes.has(dt.id)}
												onChange={() => toggleType(dt.id)}
												className="h-4 w-4 rounded border-gray-300 text-[#C2410C] focus:ring-[#0A3D62] dark:border-gray-600"
											/>
											<FileText
												aria-hidden="true"
												className="h-4 w-4 text-[#3D5568] dark:text-gray-400"
											/>
											<span className="text-sm font-bold text-[#0A3D62] dark:text-gray-100">
												{dt.label}
											</span>
										</label>
									))}
								</div>
							</>
						)}

						<button
							type="button"
							onClick={handleExport}
							disabled={(format !== "pdf" && selectedTypes.size === 0) || exporting}
							className={cn(dashboardButtonPrimary, "w-full")}
						>
							<Download aria-hidden="true" className="w-4 h-4" />
							{exporting ? t("exporting") : downloadLabel}
						</button>
					</div>
				</dialog>
			)}
		</>
	);
}

export function DataImportDialog({ canWrite = true }: { canWrite?: boolean }) {
	const t = useTranslations("dashboard.importExport");
	const dataTypes = useDataTypes();
	const [open, setOpen] = useState(false);
	const [type, setType] = useState<SheetType>("biomass_logs");
	const [file, setFile] = useState<File | null>(null);
	const [prepared, setPrepared] = useState<PreparedResponse | null>(null);
	const [overrides, setOverrides] = useState<Record<string, string>>({});
	const [preparing, setPreparing] = useState(false);
	const [importing, setImporting] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const reset = () => {
		setFile(null);
		setPrepared(null);
		setOverrides({});
	};

	const prepare = async (source: File, mapping: Record<string, string>) => {
		setPreparing(true);
		try {
			const form = new FormData();
			form.set("type", type);
			form.set("file", source);
			if (Object.keys(mapping).length > 0) form.set("mapping", JSON.stringify(mapping));
			setPrepared(await apiPostForm<PreparedResponse>("/api/v1/import-prepare", form));
		} catch (error) {
			setPrepared(null);
			toast.error(error instanceof ApiClientError ? error.message : t("previewError"));
		} finally {
			setPreparing(false);
		}
	};

	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const f = e.target.files?.[0];
		if (!f) return;
		setFile(f);
		setOverrides({});
		await prepare(f, {});
	};

	const handleMappingChange = async (field: string, header: string) => {
		if (!file) return;
		const next = { ...overrides };
		if (header === "") delete next[field];
		else next[field] = header;
		setOverrides(next);
		await prepare(file, next);
	};

	const handleImport = async () => {
		if (!prepared || prepared.csvData === "") return;
		setImporting(true);

		try {
			if (type === "feeding_schedule") {
				const result = await importFeedingSchedule(prepared.csvData);
				if (!result.success) throw new Error(result.error ?? t("importError"));
				toast.success(t("scheduleApplied"));
			} else {
				const job = await apiPost<{ id: string }>(
					"/api/v1/import-jobs",
					{ type, csvData: prepared.csvData },
					{ timeoutMs: 10_000 },
				);
				const { result } = await waitForJob<{ importedCount: number }>(job.id);
				toast.success(t("importSuccess", { count: result.importedCount }));
			}
			setOpen(false);
			reset();
		} catch (error) {
			toast.error(
				error instanceof ApiClientError || error instanceof Error
					? error.message
					: t("importError"),
			);
		} finally {
			setImporting(false);
		}
	};

	const issues = prepared?.issues ?? [];
	const capCheck = prepared?.capCheck ?? null;
	const blocked =
		!prepared ||
		prepared.structural !== null ||
		prepared.issueCount > 0 ||
		prepared.validRows === 0 ||
		capCheck?.overCap === true;

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				disabled={!canWrite}
				data-help="history-import"
				className={cn(dashboardButtonSecondary, "w-full sm:w-auto")}
			>
				<Upload aria-hidden="true" className="w-4 h-4" /> {t("import")}
			</button>

			{open && (
				<dialog
					open
					aria-modal="true"
					aria-labelledby="import-dialog-title"
					className="fixed inset-0 z-50 m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/50 p-4"
				>
					<div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-gray-900 sm:p-6">
						<div className="mb-6 flex items-center justify-between gap-4">
							<h2
								id="import-dialog-title"
								className="text-lg font-black text-[#0A3D62] dark:text-[#5b9bd5]"
							>
								{t("importTitle")}
							</h2>
							<button
								type="button"
								onClick={() => setOpen(false)}
								aria-label={t("close")}
								className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-[#3D5568] transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:focus-visible:ring-[#8fc0ea]"
							>
								<X aria-hidden="true" className="h-4 w-4" />
							</button>
						</div>

						<div className="mb-4">
							<label
								htmlFor="import-type"
								className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-300"
							>
								{t("dataType")}
							</label>
							<select
								id="import-type"
								value={type}
								onChange={(e) => {
									setType(e.target.value as SheetType);
									reset();
									if (fileInputRef.current) fileInputRef.current.value = "";
								}}
								className={dashboardField}
							>
								{dataTypes.map((dt) => (
									<option key={dt.id} value={dt.id}>
										{dt.label}
									</option>
								))}
							</select>
							<p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#3D5568] dark:text-gray-300">
								<span className="font-bold">{t("templateLabel")}:</span>
								<a
									href={`/api/v1/import-template?type=${type}&format=csv`}
									download
									className="font-bold text-[#C2410C] hover:underline dark:text-[#ff8a5c]"
								>
									{t("templateCsv")}
								</a>
								<a
									href={`/api/v1/import-template?type=${type}&format=xlsx`}
									download
									className="font-bold text-[#C2410C] hover:underline dark:text-[#ff8a5c]"
								>
									{t("templateXlsx")}
								</a>
							</p>
							{type === "feeding_schedule" && (
								<p className="mt-2 text-xs text-[#3D5568] dark:text-gray-300">
									{t("scheduleNote")}
								</p>
							)}
						</div>

						<div className="mb-4">
							<label
								htmlFor="import-file"
								className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-300"
							>
								{t("selectFile")}
							</label>
							<input
								ref={fileInputRef}
								id="import-file"
								type="file"
								accept=".csv,.xlsx"
								onChange={handleFileChange}
								className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3 text-sm font-bold text-[#0A3D62] file:mr-4 file:rounded-lg file:border-0 file:bg-[#C2410C] file:px-3 file:py-1 file:text-sm file:font-bold file:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus-visible:ring-[#8fc0ea]"
							/>
						</div>

						{prepared && (
							<p
								className="mb-4 text-sm font-bold text-[#0A3D62] dark:text-gray-100"
								aria-live="polite"
							>
								{t("rowsReady", { valid: prepared.validRows, total: prepared.totalRows })}
							</p>
						)}

						{prepared?.structural && (
							<div
								role="alert"
								className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-[#C42B3A] dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"
							>
								{t(`structural.${prepared.structural}`, { fields: prepared.unmatched.join(", ") })}
							</div>
						)}

						{prepared && prepared.headers.length > 0 && (
							<details open={prepared.unmatched.length > 0} className="mb-4">
								<summary className="min-h-11 cursor-pointer text-xs font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-300">
									{t("mappingTitle")}
								</summary>
								<p className="mb-2 text-xs text-[#3D5568] dark:text-gray-300">{t("mappingHint")}</p>
								<div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
									<table className="w-full text-left text-xs">
										<caption className="sr-only">{t("mappingTitle")}</caption>
										<thead className="bg-gray-50 dark:bg-gray-800">
											<tr>
												<th
													scope="col"
													className="px-3 py-2 font-bold text-[#3D5568] dark:text-gray-300"
												>
													{t("mappingField")}
												</th>
												<th
													scope="col"
													className="px-3 py-2 font-bold text-[#3D5568] dark:text-gray-300"
												>
													{t("mappingColumn")}
												</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-gray-100 dark:divide-gray-800">
											{TYPE_FIELDS[type].map((field) => (
												<tr key={field.name}>
													<th
														scope="row"
														className="px-3 py-2 font-bold text-[#0A3D62] dark:text-gray-100"
													>
														{field.name}
														{field.required && (
															<>
																<span aria-hidden="true"> *</span>
																<span className="sr-only"> ({t("required")})</span>
															</>
														)}
													</th>
													<td className="px-3 py-2">
														<select
															aria-label={field.name}
															value={prepared.mapping[field.name] ?? ""}
															disabled={preparing}
															onChange={(e) => handleMappingChange(field.name, e.target.value)}
															className={dashboardField}
														>
															<option value="">{t("mappingNone")}</option>
															{prepared.headers.map((header) => (
																<option key={header} value={header}>
																	{header}
																</option>
															))}
														</select>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</details>
						)}

						{issues.length > 0 && (
							<div
								role="alert"
								className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-500/25 dark:bg-red-500/10"
							>
								<div className="mb-2 flex items-center gap-2">
									<AlertCircle
										aria-hidden="true"
										className="h-4 w-4 text-[#C42B3A] dark:text-red-300"
									/>
									<span className="text-sm font-bold text-[#C42B3A] dark:text-red-200">
										{t("validationErrors", { count: prepared?.issueCount ?? issues.length })}
									</span>
								</div>
								<div className="max-h-32 space-y-1 overflow-y-auto">
									{issues.slice(0, 10).map((err) => (
										<p
											key={`${err.row}-${err.field}-${err.message}`}
											className="text-xs text-[#C42B3A] dark:text-red-200"
										>
											{t("rowError", { row: err.row, field: err.field, message: err.message })}
										</p>
									))}
								</div>
							</div>
						)}

						{prepared?.schedule && (
							<p className="mb-4 text-sm text-[#0A3D62] dark:text-gray-100">
								{t("schedulePreview", {
									count: prepared.schedule.feedsPerDay,
									start: prepared.schedule.scheduleStart,
									end: prepared.schedule.scheduleEnd,
								})}{" "}
								{capCheck &&
									t(capCheck.overCap ? "capOver" : "capOk", {
										daily: Math.round(capCheck.dailyG),
										cap: Math.round(capCheck.capG),
									})}
							</p>
						)}

						{prepared && prepared.preview.length > 0 && (
							<div className="mb-4">
								<p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-300">
									{t("preview", { count: prepared.preview.length })}
								</p>
								<div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
									<table className="w-full text-left text-xs">
										<caption className="sr-only">{t("previewTableLabel")}</caption>
										<thead className="bg-gray-50 dark:bg-gray-800">
											<tr>
												{Object.keys(prepared.preview[0]).map((key) => (
													<th
														key={key}
														scope="col"
														className="px-3 py-2 font-bold text-[#3D5568] dark:text-gray-300"
													>
														{key}
													</th>
												))}
											</tr>
										</thead>
										<tbody className="divide-y divide-gray-100 dark:divide-gray-800">
											{prepared.preview.map((row, i) => (
												<tr
													key={`row-${i}-${JSON.stringify(row)}`}
													className="hover:bg-gray-50 dark:hover:bg-gray-800/60"
												>
													{Object.entries(row).map(([col, val]) => (
														<td key={col} className="px-3 py-2 text-[#0A3D62] dark:text-gray-100">
															{String(val ?? "")}
														</td>
													))}
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>
						)}

						<button
							type="button"
							onClick={handleImport}
							disabled={blocked || preparing || importing}
							className={cn(dashboardButtonPrimary, "w-full")}
						>
							{importing ? (
								t("importing")
							) : (
								<>
									<CheckCircle2 aria-hidden="true" className="w-4 h-4" /> {t("confirmImport")}
								</>
							)}
						</button>
					</div>
				</dialog>
			)}
		</>
	);
}
