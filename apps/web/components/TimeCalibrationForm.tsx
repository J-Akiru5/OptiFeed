"use client";

import { setDeviceTime } from "@/lib/actions/time";
import { localDateTimeToIso, toLocalDateTimeInput } from "@/lib/device-time";
import { CheckCircle2, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function TimeCalibrationForm({
	deviceId,
	canWrite = true,
}: { deviceId: string; canWrite?: boolean }) {
	const t = useTranslations("dashboard.timeCalibration");
	// Start empty on both server and client, then fill the local wall time after
	// hydration. Computing it during render would use the server's timezone on
	// the server and the browser's on the client (hydration mismatch).
	const [selectedTime, setSelectedTime] = useState("");
	const [saving, setSaving] = useState(false);
	const [success, setSuccess] = useState(false);

	useEffect(() => {
		setSelectedTime(toLocalDateTimeInput(new Date()));
	}, []);

	const handleSetTime = async () => {
		if (!selectedTime) {
			toast.error(t("error"));
			return;
		}
		const isoTime = localDateTimeToIso(selectedTime);
		if (!isoTime) {
			toast.error(t("error"));
			return;
		}

		setSaving(true);
		setSuccess(false);
		try {
			const result = await setDeviceTime(deviceId, isoTime);
			if (result.success) {
				setSuccess(true);
				toast.success(t("saved"));
				setTimeout(() => setSuccess(false), 3000);
			} else {
				toast.error(result.error ?? t("error"));
			}
		} catch {
			toast.error(t("error"));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
			<div className="flex items-center gap-3 mb-6">
				<div className="w-12 h-12 rounded-2xl bg-[#0A3D62]/5 flex items-center justify-center">
					<Clock className="w-6 h-6 text-[#0A3D62]" />
				</div>
				<div>
					<h3 className="text-lg font-black text-[#0A3D62]">{t("title")}</h3>
					<p className="text-xs text-[#3D5568]">{t("desc")}</p>
				</div>
			</div>

			<div className="flex flex-col sm:flex-row gap-4">
				<div className="flex-1">
					<label
						htmlFor="device-time"
						className="block text-xs font-bold text-[#3D5568] uppercase tracking-wider mb-1.5"
					>
						{t("selectTime")}
					</label>
					<input
						id="device-time"
						type="datetime-local"
						value={selectedTime}
						onChange={(e) => setSelectedTime(e.target.value)}
						className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3 text-sm font-semibold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/50 focus:border-[#E85A2A] transition-all"
					/>
				</div>

				<div className="flex items-end">
					<button
						type="button"
						onClick={handleSetTime}
						disabled={saving || !canWrite}
						className="w-full sm:w-auto bg-[#0A3D62] hover:bg-[#12588c] text-white font-bold py-3 px-6 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
					>
						{success ? (
							<>
								<CheckCircle2 className="w-4 h-4" /> {t("set")}
							</>
						) : saving ? (
							t("setting")
						) : (
							t("set")
						)}
					</button>
				</div>
			</div>
		</div>
	);
}
