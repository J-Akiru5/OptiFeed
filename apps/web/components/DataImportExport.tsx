"use client";

import {
	EXPORT_LABELS,
	type ExportableType,
	buildFilename,
	downloadCsv,
	parseCsvString,
} from "@/lib/csv";
import { AlertCircle, CheckCircle2, Download, FileText, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

type DataTypeOption = {
	id: ExportableType;
	label: string;
};

const DATA_TYPES: DataTypeOption[] = Object.entries(EXPORT_LABELS).map(([id, label]) => ({
	id: id as ExportableType,
	label,
}));

export function DataExportButton() {
	const t = useTranslations("dashboard.importExport");
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
		if (selectedTypes.size === DATA_TYPES.length) {
			setSelectedTypes(new Set());
		} else {
			setSelectedTypes(new Set(DATA_TYPES.map((dt) => dt.id)));
		}
	};

	const handleExport = async () => {
		if (selectedTypes.size === 0) return;

		setExporting(true);
		try {
			if (selectedTypes.size === 1) {
				const type = Array.from(selectedTypes)[0];
				const res = await fetch(`/api/export?type=${type}`);
				if (!res.ok) throw new Error("Export failed");
				const csv = await res.text();
				downloadCsv(buildFilename(type), csv);
				toast.success(t("exportSuccess"));
			} else {
				const types = Array.from(selectedTypes).join(",");
				const res = await fetch(`/api/export/batch?types=${types}`);
				if (!res.ok) throw new Error("Export failed");
				const blob = await res.blob();
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = `optifeed_export_${new Date().toISOString().slice(0, 10)}.zip`;
				link.click();
				URL.revokeObjectURL(url);
				toast.success(t("batchExportSuccess"));
			}
			setOpen(false);
			setSelectedTypes(new Set());
		} catch {
			toast.error(t("exportError"));
		} finally {
			setExporting(false);
		}
	};

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex items-center gap-2 bg-[#0A3D62] hover:bg-[#12588c] text-white font-bold py-2.5 px-4 rounded-xl text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
			>
				<Download className="w-4 h-4" /> {t("export")}
			</button>

			{open && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
					<div className="bg-white rounded-3xl p-6 max-w-lg w-full mx-4 shadow-2xl max-h-[80vh] overflow-y-auto">
						<div className="flex items-center justify-between mb-6">
							<h3 className="text-lg font-black text-[#0A3D62]">{t("exportTitle")}</h3>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
							>
								<X className="w-4 h-4 text-gray-500" />
							</button>
						</div>

						<div className="mb-4">
							<button
								type="button"
								onClick={selectAll}
								className="text-xs font-bold text-[#E85A2A] hover:underline"
							>
								{selectedTypes.size === DATA_TYPES.length ? t("deselectAll") : t("selectAll")}
							</button>
						</div>

						<div className="space-y-2 mb-6">
							{DATA_TYPES.map((dt) => (
								<label
									key={dt.id}
									className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:bg-[#F4F7F6] cursor-pointer transition-colors"
								>
									<input
										type="checkbox"
										checked={selectedTypes.has(dt.id)}
										onChange={() => toggleType(dt.id)}
										className="w-4 h-4 rounded border-gray-300 text-[#E85A2A] focus:ring-[#E85A2A]"
									/>
									<FileText className="w-4 h-4 text-[#3D5568]" />
									<span className="text-sm font-semibold text-[#0A3D62]">{dt.label}</span>
								</label>
							))}
						</div>

						<button
							type="button"
							onClick={handleExport}
							disabled={selectedTypes.size === 0 || exporting}
							className="w-full bg-[#E85A2A] hover:bg-[#d14e22] text-white font-bold py-3 px-6 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
						>
							<Download className="w-4 h-4" />
							{exporting
								? t("exporting")
								: selectedTypes.size > 1
									? t("downloadZip")
									: t("downloadCsv")}
						</button>
					</div>
				</div>
			)}
		</>
	);
}

export function DataImportDialog() {
	const t = useTranslations("dashboard.importExport");
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
			const res = await fetch("/api/import", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ type, csvData: csv }),
			});
			const data = await res.json();
			setPreview(data.preview);
			setErrors(data.validationErrors);
		} catch {
			toast.error(t("previewError"));
		}
	};

	const handleImport = async () => {
		if (!file) return;
		setImporting(true);

		try {
			const csv = await file.text();
			const res = await fetch("/api/import/confirm", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ type, csvData: csv }),
			});
			const data = await res.json();
			if (data.success) {
				toast.success(t("importSuccess", { count: data.importedCount }));
				setOpen(false);
				setFile(null);
				setPreview(null);
				setErrors([]);
			} else {
				toast.error(data.error ?? t("importError"));
			}
		} catch {
			toast.error(t("importError"));
		} finally {
			setImporting(false);
		}
	};

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex items-center gap-2 bg-white border border-gray-200 hover:bg-[#F4F7F6] text-[#0A3D62] font-bold py-2.5 px-4 rounded-xl text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
			>
				<Upload className="w-4 h-4" /> {t("import")}
			</button>

			{open && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
					<div className="bg-white rounded-3xl p-6 max-w-2xl w-full mx-4 shadow-2xl max-h-[80vh] overflow-y-auto">
						<div className="flex items-center justify-between mb-6">
							<h3 className="text-lg font-black text-[#0A3D62]">{t("importTitle")}</h3>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
							>
								<X className="w-4 h-4 text-gray-500" />
							</button>
						</div>

						<div className="mb-4">
							<label
								htmlFor="import-type"
								className="block text-xs font-bold text-[#3D5568] uppercase tracking-wider mb-1.5"
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
								className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3 text-sm font-semibold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/50 transition-all"
							>
								{DATA_TYPES.map((dt) => (
									<option key={dt.id} value={dt.id}>
										{dt.label}
									</option>
								))}
							</select>
						</div>

						<div className="mb-4">
							<label
								htmlFor="import-file"
								className="block text-xs font-bold text-[#3D5568] uppercase tracking-wider mb-1.5"
							>
								{t("selectFile")}
							</label>
							<input
								ref={fileInputRef}
								id="import-file"
								type="file"
								accept=".csv"
								onChange={handleFileChange}
								className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3 text-sm font-semibold text-[#0A3D62] file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-[#E85A2A] file:text-white file:font-bold file:text-sm"
							/>
						</div>

						{errors.length > 0 && (
							<div className="mb-4 p-4 bg-red-50 rounded-2xl border border-red-200">
								<div className="flex items-center gap-2 mb-2">
									<AlertCircle className="w-4 h-4 text-red-600" />
									<span className="text-sm font-bold text-red-600">
										{t("validationErrors", { count: errors.length })}
									</span>
								</div>
								<div className="space-y-1 max-h-32 overflow-y-auto">
									{errors.slice(0, 10).map((err) => (
										<p
											key={`${err.row}-${err.field}-${err.message}`}
											className="text-xs text-red-500"
										>
											Row {err.row}: {err.field} — {err.message}
										</p>
									))}
								</div>
							</div>
						)}

						{preview && preview.length > 0 && (
							<div className="mb-4">
								<p className="text-xs font-bold text-[#3D5568] uppercase tracking-wider mb-2">
									{t("preview", { count: preview.length })}
								</p>
								<div className="overflow-x-auto rounded-xl border border-gray-200">
									<table className="w-full text-xs text-left">
										<thead className="bg-gray-50">
											<tr>
												{Object.keys(preview[0]).map((key) => (
													<th key={key} className="px-3 py-2 font-bold text-[#3D5568]">
														{key}
													</th>
												))}
											</tr>
										</thead>
										<tbody className="divide-y divide-gray-100">
											{preview.map((row, i) => (
												<tr key={`row-${i}-${JSON.stringify(row)}`} className="hover:bg-gray-50">
													{Object.entries(row).map(([col, val]) => (
														<td key={col} className="px-3 py-2 text-[#0A3D62]">
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
							className="w-full bg-[#E85A2A] hover:bg-[#d14e22] text-white font-bold py-3 px-6 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
						>
							{importing ? (
								t("importing")
							) : (
								<>
									<CheckCircle2 className="w-4 h-4" /> {t("confirmImport")}
								</>
							)}
						</button>
					</div>
				</div>
			)}
		</>
	);
}
