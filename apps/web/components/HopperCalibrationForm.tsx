"use client";

import {
	dashboardButtonPrimary,
	dashboardField,
	dashboardHint,
	dashboardLabel,
} from "@/components/dashboard/dashboard-classes";
import { saveHopperCalibration } from "@/lib/actions/energy";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface HopperCalibrationFormProps {
	deviceId: string;
	hopperFullCm: number | null;
	hopperEmptyCm: number | null;
	hopperCapacityG: number | null;
	canWrite?: boolean;
}

export function HopperCalibrationForm({
	deviceId,
	hopperFullCm,
	hopperEmptyCm,
	hopperCapacityG,
	canWrite = true,
}: HopperCalibrationFormProps) {
	const t = useTranslations("dashboard.appSettings");
	const [fullCm, setFullCm] = useState(hopperFullCm ?? 5);
	const [emptyCm, setEmptyCm] = useState(hopperEmptyCm ?? 30);
	const [capacityG, setCapacityG] = useState(hopperCapacityG ?? 7000);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [isPending, startTransition] = useTransition();

	const handleSave = () => {
		setError(null);
		setSaved(false);
		startTransition(async () => {
			const result = await saveHopperCalibration(deviceId, {
				hopperFullCm: Number(fullCm),
				hopperEmptyCm: Number(emptyCm),
				hopperCapacityG: Number(capacityG),
			});
			if (result.success) {
				setSaved(true);
				toast.success(t("calibrationSaved"));
			} else {
				const message = result.error ?? t("calibrationSaveError");
				setError(message);
				toast.error(message);
			}
		});
	};

	return (
		<div className="space-y-4">
			<div>
				<label htmlFor="hopperFullCm" className={dashboardLabel}>
					{t("hopperFullCm")}
				</label>
				<input
					id="hopperFullCm"
					type="number"
					min={0}
					max={100}
					step={0.1}
					inputMode="decimal"
					value={fullCm}
					onChange={(e) => setFullCm(Number(e.target.value))}
					disabled={!canWrite}
					className={dashboardField}
				/>
				<span className={dashboardHint}>{t("hopperFullCmDesc")}</span>
			</div>
			<div>
				<label htmlFor="hopperEmptyCm" className={dashboardLabel}>
					{t("hopperEmptyCm")}
				</label>
				<input
					id="hopperEmptyCm"
					type="number"
					min={0}
					max={200}
					step={0.1}
					inputMode="decimal"
					value={emptyCm}
					onChange={(e) => setEmptyCm(Number(e.target.value))}
					disabled={!canWrite}
					className={dashboardField}
				/>
				<span className={dashboardHint}>{t("hopperEmptyCmDesc")}</span>
			</div>
			<div>
				<label htmlFor="hopperCapacityG" className={dashboardLabel}>
					{t("hopperCapacityG")}
				</label>
				<input
					id="hopperCapacityG"
					type="number"
					min={0}
					max={50000}
					step={100}
					inputMode="numeric"
					value={capacityG}
					onChange={(e) => setCapacityG(Number(e.target.value))}
					disabled={!canWrite}
					className={dashboardField}
				/>
				<span className={dashboardHint}>{t("hopperCapacityGDesc")}</span>
			</div>

			{error && (
				<p role="alert" className="text-sm font-bold text-[#C42B3A] dark:text-red-300">
					{error}
				</p>
			)}
			{saved && (
				<output className="block text-sm font-bold text-[#1E7B34] dark:text-green-300">
					{t("calibrationSaved")}
				</output>
			)}

			<button
				type="button"
				onClick={handleSave}
				disabled={isPending || !canWrite}
				className={cn(dashboardButtonPrimary, "w-full sm:w-auto")}
			>
				{isPending ? t("saving") : t("saveCalibration")}
			</button>
		</div>
	);
}
