"use client";

import { useModalDialog } from "@/components/ui/use-modal-dialog";
import { useRouter } from "@/i18n/routing";
import { deleteBiomassLog, updateBiomassLog } from "@/lib/actions/biomass";
import { farmWallClock } from "@/lib/date-local";
import { Loader2, Pencil, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

interface BiomassLogActionsProps {
	log: {
		id: string;
		recordedAt: string;
		sampleCount: number;
		sampleWeightKg: number;
		sampleLengthCm: number;
		batchLabel: string | null;
	};
	canWrite: boolean;
}

/**
 * The date input is a farm-calendar value, not the UTC date. A sample recorded
 * at 00:30 Manila is still the previous day in the ISO string, so slicing
 * `recordedAt` made the edit form prefill the wrong day (#757).
 */
export function farmDateInputValue(iso: string): string {
	const date = new Date(iso);
	if (!Number.isFinite(date.getTime())) return iso.slice(0, 10);
	const { year, month, day } = farmWallClock(date);
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
		return iso.slice(0, 10);
	}
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function BiomassLogActions({ log, canWrite }: BiomassLogActionsProps) {
	const t = useTranslations("dashboard.logSample");
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const titleId = useId();
	const closeEdit = () => setOpen(false);
	const panelRef = useModalDialog<HTMLFormElement>(open, closeEdit);
	const [count, setCount] = useState(String(log.sampleCount));
	const [weight, setWeight] = useState(String(log.sampleWeightKg));
	const [length, setLength] = useState(String(log.sampleLengthCm));
	const [label, setLabel] = useState(log.batchLabel ?? "");
	const [recordedAt, setRecordedAt] = useState(() => farmDateInputValue(log.recordedAt));
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	if (!canWrite) return null;

	const save = (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		const parsedCount = Number.parseInt(count, 10);
		const parsedWeight = Number.parseFloat(weight);
		const parsedLength = Number.parseFloat(length);
		if (
			!Number.isFinite(parsedCount) ||
			parsedCount < 1 ||
			!Number.isFinite(parsedWeight) ||
			parsedWeight <= 0 ||
			!Number.isFinite(parsedLength) ||
			parsedLength < 0
		) {
			setError(t("logUpdateError"));
			return;
		}

		startTransition(async () => {
			const result = await updateBiomassLog({
				id: log.id,
				sampleCount: parsedCount,
				sampleWeightKg: parsedWeight,
				sampleLengthCm: parsedLength,
				batchLabel: label.trim() === "" ? null : label.trim(),
				recordedAt,
			});
			if (result.success) {
				toast.success(t("logUpdated"));
				setOpen(false);
				router.refresh();
			} else {
				setError(result.error);
				toast.error(result.error);
			}
		});
	};

	const remove = () => {
		if (!window.confirm(t("deleteLogConfirm"))) return;
		startTransition(async () => {
			const result = await deleteBiomassLog(log.id);
			if (result.success) {
				toast.success(t("logDeleted"));
				router.refresh();
			} else {
				toast.error(result.error);
			}
		});
	};

	return (
		<div className="flex items-center justify-end gap-1">
			<button
				type="button"
				onClick={() => setOpen(true)}
				disabled={isPending}
				aria-label={t("editLog")}
				className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-[var(--ofd-base)] disabled:opacity-50 dark:hover:bg-gray-800"
			>
				<Pencil className="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				onClick={remove}
				disabled={isPending}
				aria-label={t("deleteLog")}
				className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30"
			>
				{isPending ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin" />
				) : (
					<Trash2 className="h-3.5 w-3.5" />
				)}
			</button>

			{open && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
					{/* biome-ignore lint/a11y/useSemanticElements: a native <dialog> needs
					imperative showModal() and its own top-layer behaviour; this controlled
					form keeps Escape, the focus trap and scroll lock in one place. */}
					<form
						role="dialog"
						ref={panelRef}
						onSubmit={save}
						aria-modal="true"
						aria-labelledby={titleId}
						tabIndex={-1}
						className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-6 shadow-2xl outline-none dark:border-gray-700 dark:bg-gray-900"
					>
						<div className="flex items-start justify-between gap-3">
							<div>
								<h3 id={titleId} className="text-lg font-black text-[var(--ofd-base-deep)]">
									{t("editLogTitle")}
								</h3>
								<p className="text-xs text-gray-500">{t("lastSaved", { date: recordedAt })}</p>
							</div>
							<button
								type="button"
								onClick={closeEdit}
								className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
								aria-label={t("cancelLog")}
							>
								<X className="h-4 w-4" aria-hidden="true" />
							</button>
						</div>

						<div className="mt-5 grid gap-3 sm:grid-cols-2">
							<label className="text-xs font-bold text-gray-600 dark:text-gray-300">
								{t("batchEntryDate")}
								<input
									type="date"
									value={recordedAt}
									onChange={(event) => setRecordedAt(event.target.value)}
									data-autofocus
									className="mt-1 w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2 text-sm font-semibold text-[#0A3D62] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
									required
								/>
							</label>
							<label className="text-xs font-bold text-gray-600 dark:text-gray-300">
								{t("batchEntrySamples")}
								<input
									type="number"
									min={1}
									value={count}
									onChange={(event) => setCount(event.target.value)}
									className="mt-1 w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2 text-sm font-semibold text-[#0A3D62] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
									required
								/>
							</label>
							<label className="text-xs font-bold text-gray-600 dark:text-gray-300">
								{t("weightLabel")}
								<input
									type="number"
									min={0.01}
									step="0.01"
									value={weight}
									onChange={(event) => setWeight(event.target.value)}
									className="mt-1 w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2 text-sm font-semibold text-[#0A3D62] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
									required
								/>
							</label>
							<label className="text-xs font-bold text-gray-600 dark:text-gray-300">
								{t("lengthLabel")}
								<input
									type="number"
									min={0}
									step="0.1"
									value={length}
									onChange={(event) => setLength(event.target.value)}
									className="mt-1 w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2 text-sm font-semibold text-[#0A3D62] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
								/>
							</label>
							<label className="text-xs font-bold text-gray-600 dark:text-gray-300 sm:col-span-2">
								{t("batchLabel")}
								<input
									type="text"
									maxLength={64}
									value={label}
									onChange={(event) => setLabel(event.target.value)}
									className="mt-1 w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2 text-sm font-semibold text-[#0A3D62] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
								/>
							</label>
						</div>

						{error && <p className="mt-3 text-xs font-semibold text-red-600">{error}</p>}

						<div className="mt-5 flex justify-end gap-2">
							<button
								type="button"
								onClick={closeEdit}
								disabled={isPending}
								className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
							>
								{t("cancelLog")}
							</button>
							<button
								type="submit"
								disabled={isPending}
								className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--ofd-base)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
							>
								{isPending && <Loader2 className="h-4 w-4 animate-spin" />}
								{isPending ? t("savingLog") : t("saveLog")}
							</button>
						</div>
					</form>
				</div>
			)}
		</div>
	);
}
