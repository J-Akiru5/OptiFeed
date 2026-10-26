"use client";

import {
	dashboardButtonPrimary,
	dashboardButtonSecondary,
	dashboardField,
} from "@/components/dashboard/dashboard-classes";
import { ApiClientError, apiPost } from "@/lib/api-client";
import { type ExportableType, buildFilename, downloadCsv } from "@/lib/csv";
import { fetchJobArtifact, waitForJob } from "@/lib/jobs/client";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Download, FileText, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

const DATA_TYPE_IDS: ExportableType[] = [
	"biomass_logs",
	"fish_samples",
	"feed_events",
	"fcr_reports",
	"feed_level_logs",
	"notifications",
	"audit_events",
];

function useDataTypes() {
	const t = useTranslations("dashboard.importExport");
	return DATA_TYPE_IDS.map((id) => ({ id, label: t(`types.${id}`) }));
}

export function DataExportButton() {
	const t = useTranslations("dashboard.importExport");
	const dataTypes = useDataTypes();
	const [open, setOpen] = useState(false);
	const [selectedTypes, setSelectedTypes] = useState<Set<ExportableType>>(new Set());
	const [exporting, setExporting] = useState(false);

	const toggleType = (type: ExportableType) => {
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
		if (selectedTypes.size === 0) return;

		setExporting(true);
		try {
			const types = Array.from(selectedTypes);
			const single = types.length === 1;
			const job = await apiPost<{ id: string }>(
				"/api/v1/export-jobs",
				single ? { kind: "csv", type: types[0] } : { kind: "zip", types },
				{ timeoutMs: 5_000 },
			);

			const { downloadUrl } = await waitForJob(job.id);
			if (!downloadUrl) throw new Error(t("exportNotReady"));

			const response = await fetchJobArtifact(downloadUrl);
			if (!response.ok) throw new Error(t("exportDownloadFailed"));

			if (single) {
				const csv = await response.text();
				downloadCsv(buildFilename(types[0]), csv);
				toast.success(t("exportSuccess"));
			} else {
				const blob = await response.blob();
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = `pakaonai_export_${new Date().toISOString().slice(0, 10)}.zip`;
				link.click();
				URL.revokeObjectURL(url);
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

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
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

						<button
							type="button"
							onClick={handleExport}
							disabled={selectedTypes.size === 0 || exporting}
							className={cn(dashboardButtonPrimary, "w-full")}
						>
							<Download aria-hidden="true" className="w-4 h-4" />
							{exporting
								? t("exporting")
								: selectedTypes.size > 1
									? t("downloadZip")
									: t("downloadCsv")}
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
	const [type, setType] = useState<ExportableType>("biomass_logs");
	const [file, setFile] = useState<File | null>(null);
	const [preview, setPreview] = useState<Record<string, unknown>[] | null>(null);
	const [errors, setErrors] = useState<{ row: number; field: string; message: string }[]>([]);
	const [importing, setImporting] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const f = e.target.files?.[0];
		if (!f) return;
		setFile(f);
		setPreview(null);
		setErrors([]);

		const csv = await f.text();
		try {
			const result = await apiPost<{
				preview: Record<string, unknown>[];
				validationErrors: { row: number; field: string; message: string }[];
			}>("/api/import", { type, csvData: csv }, { timeoutMs: 20_000 });
			setPreview(result.preview);
			setErrors(result.validationErrors);
		} catch (error) {
			toast.error(error instanceof ApiClientError ? error.message : t("previewError"));
		}
	};

	const handleImport = async () => {
		if (!file) return;
		setImporting(true);

		try {
			const csv = await file.text();
			const job = await apiPost<{ id: string }>(
				"/api/v1/import-jobs",
				{ type, csvData: csv },
				{ timeoutMs: 10_000 },
			);
			const { result } = await waitForJob<{ importedCount: number }>(job.id);
			toast.success(t("importSuccess", { count: result.importedCount }));
			setOpen(false);
			setFile(null);
			setPreview(null);
			setErrors([]);
		} catch (error) {
			toast.error(error instanceof ApiClientError ? error.message : t("importError"));
		} finally {
			setImporting(false);
		}
	};

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				disabled={!canWrite}
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
									setType(e.target.value as ExportableType);
									setFile(null);
									setPreview(null);
									setErrors([]);
								}}
								className={dashboardField}
							>
								{dataTypes.map((dt) => (
									<option key={dt.id} value={dt.id}>
										{dt.label}
									</option>
								))}
							</select>
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
								accept=".csv"
								onChange={handleFileChange}
								className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3 text-sm font-bold text-[#0A3D62] file:mr-4 file:rounded-lg file:border-0 file:bg-[#C2410C] file:px-3 file:py-1 file:text-sm file:font-bold file:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus-visible:ring-[#8fc0ea]"
							/>
						</div>

						{errors.length > 0 && (
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
										{t("validationErrors", { count: errors.length })}
									</span>
								</div>
								<div className="max-h-32 space-y-1 overflow-y-auto">
									{errors.slice(0, 10).map((err) => (
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

						{preview && preview.length > 0 && (
							<div className="mb-4">
								<p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-300">
									{t("preview", { count: preview.length })}
								</p>
								<div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
									<table className="w-full text-left text-xs">
										<caption className="sr-only">{t("previewTableLabel")}</caption>
										<thead className="bg-gray-50 dark:bg-gray-800">
											<tr>
												{Object.keys(preview[0]).map((key) => (
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
											{preview.map((row, i) => (
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
							disabled={!file || errors.length > 0 || importing}
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
