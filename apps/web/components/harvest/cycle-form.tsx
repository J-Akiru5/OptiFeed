"use client";

import { useRouter } from "@/i18n/routing";
import { createCropCycle, updateCropCycle } from "@/lib/actions/crop-cycle";
import { addDays, daysBetween, isValidDateOnly, todayDateOnly } from "@/lib/crop-cycle/dates";
import type { CropCycleDto, PondOption } from "@/lib/crop-cycle/types";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Modal } from "./modal";

interface CycleFormProps {
	open: boolean;
	onClose: () => void;
	onSaved: () => void;
	ponds: PondOption[];
	initialPondId: string;
	cycle?: CropCycleDto | null;
}

function optionalNumber(value: string): number | null {
	if (value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

export function CycleForm({ open, onClose, onSaved, ponds, initialPondId, cycle }: CycleFormProps) {
	const t = useTranslations("dashboard.harvest.cycleForm");
	const router = useRouter();
	const today = todayDateOnly();
	const [pondId, setPondId] = useState(cycle?.pondId ?? initialPondId);
	const [label, setLabel] = useState(cycle?.label ?? "");
	const [stockingDate, setStockingDate] = useState(cycle?.stockingDate ?? today);
	const [stockingCount, setStockingCount] = useState(
		String(
			cycle?.stockingCount ?? ponds.find((pond) => pond.id === initialPondId)?.population ?? "",
		),
	);
	const [stockingAvgWeightG, setStockingAvgWeightG] = useState(
		cycle?.stockingAvgWeightG ? String(cycle.stockingAvgWeightG) : "",
	);
	const [growOutDays, setGrowOutDays] = useState(cycle?.growOutDays ?? 135);
	const [targetHarvestDate, setTargetHarvestDate] = useState(
		cycle?.targetHarvestDate ?? addDays(today, 135),
	);
	const [targetHarvestWeightG, setTargetHarvestWeightG] = useState(
		cycle?.targetHarvestWeightG ? String(cycle.targetHarvestWeightG) : "250",
	);
	const [expectedSurvivalPct, setExpectedSurvivalPct] = useState(
		cycle?.expectedSurvivalPct ? String(cycle.expectedSurvivalPct) : "85",
	);
	const [notes, setNotes] = useState(cycle?.notes ?? "");
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	useEffect(() => {
		if (!open) return;
		setPondId(cycle?.pondId ?? initialPondId);
		setLabel(cycle?.label ?? "");
		setStockingDate(cycle?.stockingDate ?? today);
		setStockingCount(
			String(
				cycle?.stockingCount ?? ponds.find((pond) => pond.id === initialPondId)?.population ?? "",
			),
		);
		setStockingAvgWeightG(cycle?.stockingAvgWeightG ? String(cycle.stockingAvgWeightG) : "");
		setGrowOutDays(cycle?.growOutDays ?? 135);
		setTargetHarvestDate(cycle?.targetHarvestDate ?? addDays(today, 135));
		setTargetHarvestWeightG(
			cycle?.targetHarvestWeightG ? String(cycle.targetHarvestWeightG) : "250",
		);
		setExpectedSurvivalPct(cycle?.expectedSurvivalPct ? String(cycle.expectedSurvivalPct) : "85");
		setNotes(cycle?.notes ?? "");
		setError(null);
	}, [open, cycle, initialPondId, ponds, today]);

	const span =
		isValidDateOnly(stockingDate) && isValidDateOnly(targetHarvestDate)
			? daysBetween(stockingDate, targetHarvestDate)
			: 0;
	const dateRangeInvalid = span < 30 || span > 365;
	const stockingFuture = daysBetween(stockingDate, today) < -7;
	const projectedKg =
		Number(stockingCount) > 0 && Number(targetHarvestWeightG) > 0
			? (Number(stockingCount) *
					(Math.min(100, Math.max(1, Number(expectedSurvivalPct) || 100)) / 100) *
					Number(targetHarvestWeightG)) /
				1000
			: null;

	const selectedPond = ponds.find((pond) => pond.id === pondId);
	const areaM2 = selectedPond?.areaM2 ?? null;
	const averageDepthM = selectedPond?.averageDepthM ?? null;
	const stockingCountNumber = Number(stockingCount);
	const densityPerM2 = areaM2 && stockingCountNumber > 0 ? stockingCountNumber / areaM2 : null;
	const densityPerM3 =
		areaM2 && averageDepthM && stockingCountNumber > 0
			? stockingCountNumber / (areaM2 * averageDepthM)
			: null;

	const onStockingDateChange = (value: string) => {
		setStockingDate(value);
		if (isValidDateOnly(value) && growOutDays >= 30) {
			setTargetHarvestDate(addDays(value, growOutDays));
		}
	};

	const onGrowOutDaysChange = (value: string) => {
		const days = Math.round(Number(value));
		if (!Number.isFinite(days)) return;
		setGrowOutDays(days);
		if (isValidDateOnly(stockingDate) && days >= 30) {
			setTargetHarvestDate(addDays(stockingDate, days));
		}
	};

	const onHarvestDateChange = (value: string) => {
		setTargetHarvestDate(value);
		if (isValidDateOnly(value) && isValidDateOnly(stockingDate)) {
			setGrowOutDays(daysBetween(stockingDate, value));
		}
	};

	const submit = () => {
		setError(null);
		if (!pondId) {
			setError(t("pondRequired"));
			return;
		}
		if (dateRangeInvalid) {
			setError(t("dateRangeError"));
			return;
		}
		if (stockingFuture) {
			setError(t("stockingFuture"));
			return;
		}
		if (!Number.isFinite(Number(stockingCount)) || Number(stockingCount) < 1) {
			setError(t("stockingCountError"));
			return;
		}

		const input = {
			pondId,
			label: label.trim() || null,
			stockingDate,
			stockingCount: Math.round(Number(stockingCount)),
			stockingAvgWeightG: optionalNumber(stockingAvgWeightG),
			growOutDays: span,
			targetHarvestDate,
			targetHarvestWeightG: optionalNumber(targetHarvestWeightG),
			expectedSurvivalPct: optionalNumber(expectedSurvivalPct),
			notes: notes.trim() || null,
		};

		startTransition(async () => {
			const result = cycle ? await updateCropCycle(cycle.id, input) : await createCropCycle(input);
			if (!result.success) {
				setError(result.error);
				return;
			}
			toast.success(cycle ? t("successUpdate") : t("successCreate"));
			router.refresh();
			onSaved();
			onClose();
		});
	};

	return (
		<Modal
			open={open}
			onClose={isPending ? () => undefined : onClose}
			title={cycle ? t("titleEdit") : t("titleNew")}
			description={t("desc")}
			size="lg"
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
				<div className="grid gap-4 sm:grid-cols-2">
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("pond")}
						</span>
						<select
							value={pondId}
							onChange={(event) => setPondId(event.target.value)}
							disabled={Boolean(cycle)}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						>
							{ponds.map((pond) => (
								<option key={pond.id} value={pond.id}>
									{pond.name}
								</option>
							))}
						</select>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("label")}
						</span>
						<input
							value={label}
							onChange={(event) => setLabel(event.target.value)}
							maxLength={64}
							placeholder={t("labelPlaceholder")}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] placeholder:text-gray-400 focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("stockingDate")}
						</span>
						<input
							type="date"
							value={stockingDate}
							onChange={(event) => onStockingDateChange(event.target.value)}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("stockingCount")}
						</span>
						<input
							type="number"
							min={1}
							max={1_000_000}
							value={stockingCount}
							onChange={(event) => setStockingCount(event.target.value)}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<div className="rounded-xl border border-dashed border-[#0A3D62]/15 bg-[#F4F7F6] px-3 py-2 text-xs text-[#3D5568] sm:col-span-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
						<span className="font-extrabold uppercase tracking-wider text-gray-500">
							{t("densityLabel")}:
						</span>{" "}
						{densityPerM2 !== null ? (
							<>
								<span className="font-bold">
									{t("densityValue", { density: densityPerM2.toFixed(1) })}
								</span>
								{densityPerM3 !== null && (
									<span> · {t("densityValueDepth", { density: densityPerM3.toFixed(1) })}</span>
								)}
							</>
						) : (
							<span>{t("densityNoArea")}</span>
						)}
						{densityPerM2 !== null && densityPerM2 > 20 && (
							<span className="ml-1 font-bold text-amber-600">{t("densityHigh")}</span>
						)}
					</div>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("growOutDays")}
						</span>
						<input
							type="number"
							min={30}
							max={365}
							value={growOutDays}
							onChange={(event) => onGrowOutDaysChange(event.target.value)}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("harvestDate")}
						</span>
						<input
							type="date"
							value={targetHarvestDate}
							onChange={(event) => onHarvestDateChange(event.target.value)}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("stockingWeight")}
						</span>
						<input
							type="number"
							min={0}
							step="0.1"
							value={stockingAvgWeightG}
							onChange={(event) => setStockingAvgWeightG(event.target.value)}
							placeholder={t("optional")}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] placeholder:text-gray-400 focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("targetWeight")}
						</span>
						<input
							type="number"
							min={1}
							step="1"
							value={targetHarvestWeightG}
							onChange={(event) => setTargetHarvestWeightG(event.target.value)}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("survival")}
						</span>
						<input
							type="number"
							min={1}
							max={100}
							step="1"
							value={expectedSurvivalPct}
							onChange={(event) => setExpectedSurvivalPct(event.target.value)}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
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

				<div className="rounded-2xl border border-[#0A3D62]/10 bg-[#0A3D62]/[0.03] p-3 dark:border-white/10 dark:bg-white/5">
					<p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
						{t("projected")}
					</p>
					<p className="mt-1 text-xl font-black text-[#0A3D62] dark:text-[#9cc7f0]">
						{projectedKg !== null ? `${projectedKg.toFixed(1)} kg` : "—"}
					</p>
					<p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
						{t("projectedHint")}
					</p>
				</div>

				{(dateRangeInvalid || stockingFuture) && (
					<p className="text-xs font-semibold text-red-600 dark:text-red-400">
						{stockingFuture ? t("stockingFuture") : t("dateRangeError")}
					</p>
				)}
				{error && (
					<p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
						{error}
					</p>
				)}
			</div>
		</Modal>
	);
}
