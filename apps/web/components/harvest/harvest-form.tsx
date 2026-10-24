"use client";

import { useRouter } from "@/i18n/routing";
import { markCycleHarvested } from "@/lib/actions/crop-cycle";
import { todayDateOnly } from "@/lib/crop-cycle/dates";
import type { CropCycleDto } from "@/lib/crop-cycle/types";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Modal } from "./modal";

interface HarvestFormProps {
	open: boolean;
	onClose: () => void;
	onSaved: () => void;
	cycle: CropCycleDto | null;
}

export function HarvestForm({ open, onClose, onSaved, cycle }: HarvestFormProps) {
	const t = useTranslations("dashboard.harvest.harvestForm");
	const router = useRouter();
	const [actualDate, setActualDate] = useState(todayDateOnly());
	const [weightKg, setWeightKg] = useState("");
	const [count, setCount] = useState("");
	const [fcr, setFcr] = useState("");
	const [notes, setNotes] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	useEffect(() => {
		if (!open || !cycle) return;
		setActualDate(todayDateOnly());
		setWeightKg("");
		setCount(String(cycle.stockingCount));
		setFcr(cycle.actualFcr ? String(cycle.actualFcr) : "");
		setNotes("");
		setError(null);
	}, [open, cycle]);

	if (!cycle) return null;

	const submit = () => {
		setError(null);
		const weight = Number(weightKg);
		const harvestedCount = Number(count);
		if (!Number.isFinite(weight) || weight <= 0) {
			setError(t("weightError"));
			return;
		}
		if (!Number.isFinite(harvestedCount) || harvestedCount < 0) {
			setError(t("countError"));
			return;
		}

		startTransition(async () => {
			const result = await markCycleHarvested({
				pondId: cycle.pondId,
				cycleId: cycle.id,
				actualHarvestDate: actualDate,
				actualHarvestWeightKg: weight,
				actualHarvestCount: Math.round(harvestedCount),
				actualFcr: fcr.trim() === "" ? null : Number(fcr),
				notes: notes.trim() || null,
			});
			if (!result.success) {
				setError(result.error);
				return;
			}
			toast.success(t("success"));
			router.refresh();
			onSaved();
			onClose();
		});
	};

	return (
		<Modal
			open={open}
			onClose={isPending ? () => undefined : onClose}
			title={t("title")}
			description={t("desc")}
			footer={
				<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<button
						type="button"
						onClick={onClose}
						disabled={isPending}
						className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
					>
						{t("cancel")}
					</button>
					<button
						type="button"
						onClick={submit}
						disabled={isPending}
						className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#164e7c] disabled:opacity-50 dark:bg-[#1f66a0]"
					>
						{isPending && <Loader2 className="h-4 w-4 animate-spin" />}
						{isPending ? t("saving") : t("save")}
					</button>
				</div>
			}
		>
			<div className="space-y-4">
				<div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
					{t("pauseNotice")}
				</div>

				<div className="grid gap-4 sm:grid-cols-2">
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("date")}
						</span>
						<input
							type="date"
							value={actualDate}
							max={todayDateOnly()}
							onChange={(event) => setActualDate(event.target.value)}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("weight")}
						</span>
						<input
							type="number"
							min={0.1}
							step="0.1"
							value={weightKg}
							onChange={(event) => setWeightKg(event.target.value)}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("count")}
						</span>
						<input
							type="number"
							min={0}
							step="1"
							value={count}
							onChange={(event) => setCount(event.target.value)}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("fcr")}
						</span>
						<input
							type="number"
							min={0.5}
							max={10}
							step="0.01"
							value={fcr}
							onChange={(event) => setFcr(event.target.value)}
							placeholder={t("fcrPlaceholder")}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] placeholder:text-gray-400 focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
				</div>

				<label className="block">
					<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
						{t("notes")}
					</span>
					<textarea
						value={notes}
						onChange={(event) => setNotes(event.target.value)}
						rows={3}
						maxLength={1_000}
						placeholder={t("notesPlaceholder")}
						className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-medium text-[#0A3D62] placeholder:text-gray-400 focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
					/>
				</label>

				{error && (
					<p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
						{error}
					</p>
				)}
			</div>
		</Modal>
	);
}
