"use client";

import { useRouter } from "@/i18n/routing";
import { deleteBiomassLog, updateBiomassLog } from "@/lib/actions/biomass";
import { Loader2, Pencil, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
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

export function BiomassLogActions({ log, canWrite }: BiomassLogActionsProps) {
	const t = useTranslations("dashboard.logSample");
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [count, setCount] = useState(String(log.sampleCount));
	const [weight, setWeight] = useState(String(log.sampleWeightKg));
	const [length, setLength] = useState(String(log.sampleLengthCm));
	const [label, setLabel] = useState(log.batchLabel ?? "");
	const [recordedAt, setRecordedAt] = useState(log.recordedAt.slice(0, 10));
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
					<form
						onSubmit={save}
						className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-900"
					>
						<div className="flex items-start justify-between gap-3">
							<div>
								<h3 className="text-lg font-black text-[var(--ofd-base-deep)]">
									{t("editLogTitle")}
								</h3>
								<p className="text-xs text-gray-500">{t("lastSaved", { date: recordedAt })}</p>
							</div>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
								aria-label={t("cancelLog")}
							>
								<X className="h-4 w-4" />
							</button>
						</div>

						<div className="mt-5 grid gap-3 sm:grid-cols-2">
							<label className="text-xs font-bold text-gray-600 dark:text-gray-300">
								{t("batchEntryDate")}
								<input
									type="date"
									value={recordedAt}
									onChange={(event) => setRecordedAt(event.target.value)}
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
								onClick={() => setOpen(false)}
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
