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

	// #269: this card lives in the 22rem control-room rail as well as in the wide
	// schedule column, so the input/button row must follow the *card* width, not
	// the viewport. `@container` + `@sm:flex-row` stacks the two controls while
	// the card is narrow (the rail) and keeps them side by side when there is
	// room. The old `sm:flex-row` split them at 640 px of viewport, which put a
	// ~200 px unshrinkable `datetime-local` input and the button inside a ~300 px
	// card: the row overflowed, the button was clipped and the rail scrolled
	// horizontally. `min-w-0` lets the flex item shrink with the card.
	return (
		<div
			className="@container min-w-0 bg-white rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 dark:bg-gray-900"
			data-help="schedule-calibration"
		>
			<div className="flex items-center gap-3 mb-6">
				<div className="w-12 h-12 rounded-2xl bg-[#0A3D62]/5 flex items-center justify-center dark:bg-white/5">
					<Clock className="w-6 h-6 text-[#0A3D62] dark:text-[#5b9bd5]" />
				</div>
				<div>
					<h3 className="text-lg font-black text-[#0A3D62] dark:text-[#5b9bd5]">{t("title")}</h3>
					<p className="text-xs text-[#3D5568] dark:text-gray-400">{t("desc")}</p>
				</div>
			</div>

			<div className="flex flex-col gap-4 @sm:flex-row">
				<div className="min-w-0 flex-1">
					<label
						htmlFor="device-time"
						className="block text-xs font-bold text-[#3D5568] dark:text-gray-400 uppercase tracking-wider mb-1.5"
					>
						{t("selectTime")}
					</label>
					<input
						id="device-time"
						type="datetime-local"
						value={selectedTime}
						onChange={(e) => setSelectedTime(e.target.value)}
						className="w-full min-w-0 rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3 text-sm font-semibold text-[#0A3D62] transition-all focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:[color-scheme:dark]"
					/>
				</div>

				<div className="flex @sm:items-end">
					<button
						type="button"
						onClick={handleSetTime}
						disabled={saving || !canWrite}
						className="w-full @sm:w-auto bg-[#0A3D62] hover:bg-[#12588c] text-white font-bold py-3 px-6 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A] dark:bg-[#1f66a0] dark:hover:bg-[#2a7ab8]"
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
