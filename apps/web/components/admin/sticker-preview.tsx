"use client";

import {
	DeviceSticker,
	type DeviceStickerStrings,
	STICKERS_PER_SHEET,
} from "@/components/admin/device-sticker";
import {
	clearStickerRatingDefault,
	setStickerRatingDefault,
} from "@/lib/actions/platform/settings";
import {
	LABEL_STICKER_RATING,
	type ResolvedStickerRating,
	STICKER_CURRENT_MAX,
	STICKER_CURRENT_MIN,
	STICKER_POWER_MAX,
	STICKER_POWER_MIN,
	STICKER_VOLTAGE_MAX,
	STICKER_VOLTAGE_MIN,
	type StickerRatingEnteredBy,
	type StickerRatingSource,
	type StickerRatingValues,
	applyStickerRatingParams,
	clearStickerRatingParams,
	computePowerVA,
	isIsoDateString,
} from "@/lib/constants/sticker-rating";
import { todayDateOnly } from "@/lib/crop-cycle/dates";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * The rating editor and live sticker preview (decision E17, issue #197).
 *
 * The numbers are edited here and rendered instantly on every sticker on the
 * sheet. A per-print override lives in the page URL (so the print is
 * reproducible and shareable); saving a default for all stickers is a
 * platform-admin action and goes through `lib/actions/platform/settings.ts`.
 */

const FIELD_LABEL = "block text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568]";
const FIELD_INPUT =
	"mt-1 w-full rounded-xl border border-[#C9D6E5] bg-[#F7FAFD] px-3 py-2 text-sm text-[#0A3D62] transition-colors focus:outline-none focus:ring-2 focus:ring-[#E85A2A] disabled:cursor-not-allowed disabled:opacity-60";
const FIELD_HINT = "mt-1 block text-[11px] leading-snug text-[#3D5568]";
const PRIMARY_BUTTON =
	"inline-flex items-center justify-center gap-2 rounded-xl bg-[#E85A2A] px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-[#d04a1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY_BUTTON =
	"inline-flex items-center justify-center gap-2 rounded-xl border border-[#0A3D62]/20 bg-white px-3 py-2 text-xs font-black text-[#0A3D62] transition-colors hover:bg-[#F4F7F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const WARNING_BOX = "rounded-xl border border-[#F5B87A] bg-[#FFF4E8] p-4 text-sm text-[#0F1B2D]";
const NOTE_BOX = "rounded-xl border border-[#B9DCC4] bg-[#F1F8F3] p-4 text-sm text-[#14532D]";

function fmt(value: number): string {
	return (Math.round(value * 100) / 100).toString();
}

function numberIn(value: string, min: number, max: number): number | null {
	if (value.trim() === "") return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
	return parsed;
}

function todayIso(): string {
	// Farm calendar day (Asia/Manila), not the browser's UTC day: at 07:00 local
	// the UTC date is still yesterday, which would stamp the wrong measurement
	// date and make the field's `max` reject today.
	return todayDateOnly();
}

type Props = {
	devices: { id: string; mac: string }[];
	stickerStrings: DeviceStickerStrings;
	/** Resolved for this print: URL override → saved default → label values. */
	initialRating: ResolvedStickerRating;
	/** What clearing the URL override returns to: the saved default or the label. */
	defaultRating: ResolvedStickerRating;
	/** The role of the person printing, used in the "entered by" warning. */
	actorRoleLabel: string;
	/** The role that can save a default; used when the values come from that default. */
	platformAdminRoleLabel: string;
	canSaveDefault: boolean;
	/** True when the URL already carried a per-print override. */
	initialOverride: boolean;
};

export function StickerPreview({
	devices,
	stickerStrings,
	initialRating,
	defaultRating,
	actorRoleLabel,
	platformAdminRoleLabel,
	canSaveDefault,
	initialOverride,
}: Props) {
	const t = useTranslations("dashboard.adminDeviceLabels");
	const [voltage, setVoltage] = useState(fmt(initialRating.voltageV));
	const [frequency, setFrequency] = useState(String(initialRating.frequencyHz));
	const [current, setCurrent] = useState(fmt(initialRating.currentA));
	const [powerOverride, setPowerOverride] = useState(
		initialRating.powerVA !== computePowerVA(initialRating.voltageV, initialRating.currentA),
	);
	const [power, setPower] = useState(String(initialRating.powerVA));
	const [measured, setMeasured] = useState(initialRating.measured);
	const [measuredAt, setMeasuredAt] = useState(initialRating.measuredAt ?? "");
	const [dirty, setDirty] = useState(initialOverride);
	const [source, setSource] = useState<StickerRatingSource>(initialRating.source);
	const [enteredBy, setEnteredBy] = useState<StickerRatingEnteredBy | null>(
		initialRating.enteredBy,
	);
	const [reason, setReason] = useState("");
	const [pending, setPending] = useState<"save" | "reset" | null>(null);
	const [fallback, setFallback] = useState<ResolvedStickerRating>(defaultRating);

	const voltageV =
		numberIn(voltage, STICKER_VOLTAGE_MIN, STICKER_VOLTAGE_MAX) ?? LABEL_STICKER_RATING.voltageV;
	const currentA =
		numberIn(current, STICKER_CURRENT_MIN, STICKER_CURRENT_MAX) ?? LABEL_STICKER_RATING.currentA;
	const frequencyHz = frequency === "50" ? 50 : 60;
	const computedPower = computePowerVA(voltageV, currentA);
	const typedPower = numberIn(power, STICKER_POWER_MIN, STICKER_POWER_MAX);
	const powerVA = powerOverride && typedPower !== null ? Math.round(typedPower) : computedPower;
	const measuredDate = measured && isIsoDateString(measuredAt) ? measuredAt : null;

	const rating: StickerRatingValues = {
		voltageV,
		frequencyHz,
		currentA,
		powerVA,
		measured,
		measuredAt: measuredDate,
	};

	const markEdited = (nextMeasured: boolean) => {
		setDirty(true);
		setSource(nextMeasured ? "measured" : "entered");
		setEnteredBy(nextMeasured ? null : "actor");
	};

	// Keep the per-print override in the URL so the sheet can be reloaded or
	// shared. Unrelated params (the selected device ids) are preserved.
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (dirty) {
			applyStickerRatingParams(params, {
				voltageV,
				frequencyHz,
				currentA,
				powerVA,
				measured,
				measuredAt: measuredDate,
			});
		} else {
			clearStickerRatingParams(params);
		}
		const query = params.toString();
		const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
		window.history.replaceState(null, "", next);
	}, [dirty, voltageV, frequencyHz, currentA, powerVA, measured, measuredDate]);

	function resetToRating(resolved: ResolvedStickerRating, nextSource: StickerRatingSource) {
		setVoltage(fmt(resolved.voltageV));
		setFrequency(String(resolved.frequencyHz));
		setCurrent(fmt(resolved.currentA));
		setPowerOverride(resolved.powerVA !== computePowerVA(resolved.voltageV, resolved.currentA));
		setPower(String(resolved.powerVA));
		setMeasured(resolved.measured);
		setMeasuredAt(resolved.measuredAt ?? "");
		setDirty(false);
		setSource(nextSource);
		setEnteredBy(resolved.enteredBy);
	}

	const handleSaveDefault = async () => {
		if (reason.trim().length < 10) {
			toast.error(t("rating.needReason"));
			return;
		}
		if (rating.measured && !rating.measuredAt) {
			toast.error(t("rating.needDate"));
			return;
		}
		setPending("save");
		try {
			const result = await setStickerRatingDefault(rating, reason.trim());
			if ("error" in result) {
				toast.error(result.error);
				return;
			}
			setReason("");
			setFallback({
				...rating,
				source: rating.measured ? "measured" : "entered",
				enteredBy: "platform",
			});
			toast.success(t("rating.saved"));
		} catch {
			toast.error(t("rating.failed"));
		} finally {
			setPending(null);
		}
	};

	const handleResetDefault = async () => {
		if (reason.trim().length < 10) {
			toast.error(t("rating.needReason"));
			return;
		}
		setPending("reset");
		try {
			const result = await clearStickerRatingDefault(reason.trim());
			if ("error" in result) {
				toast.error(result.error);
				return;
			}
			const labelRating: ResolvedStickerRating = {
				...LABEL_STICKER_RATING,
				source: "estimated",
				enteredBy: null,
			};
			setFallback(labelRating);
			resetToRating(labelRating, "estimated");
			setReason("");
			toast.success(t("rating.cleared"));
		} catch {
			toast.error(t("rating.failed"));
		} finally {
			setPending(null);
		}
	};

	const sheets: Props["devices"][] = [];
	for (let index = 0; index < devices.length; index += STICKERS_PER_SHEET) {
		sheets.push(devices.slice(index, index + STICKERS_PER_SHEET));
	}

	return (
		<>
			<section className="mb-6 space-y-4 rounded-2xl border border-[#C9D6E5] bg-white p-4 print:hidden md:p-5">
				<div>
					<h2 className="text-lg font-black text-[#0A3D62]">{t("rating.title")}</h2>
					<p className="mt-1 max-w-3xl text-sm text-[#3D5568]">{t("rating.intro")}</p>
				</div>

				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<label className="block">
						<span className={FIELD_LABEL}>{t("rating.voltage")}</span>
						<input
							type="number"
							inputMode="decimal"
							min={STICKER_VOLTAGE_MIN}
							max={STICKER_VOLTAGE_MAX}
							step={1}
							value={voltage}
							onChange={(event) => {
								setVoltage(event.target.value);
								markEdited(measured);
							}}
							onBlur={() => setVoltage(String(voltageV))}
							className={FIELD_INPUT}
						/>
					</label>

					<label className="block">
						<span className={FIELD_LABEL}>{t("rating.frequency")}</span>
						<select
							value={frequency}
							onChange={(event) => {
								setFrequency(event.target.value);
								markEdited(measured);
							}}
							className={FIELD_INPUT}
						>
							<option value="50">50 Hz</option>
							<option value="60">60 Hz</option>
						</select>
					</label>

					<label className="block">
						<span className={FIELD_LABEL}>{t("rating.current")}</span>
						<input
							type="number"
							inputMode="decimal"
							min={STICKER_CURRENT_MIN}
							max={STICKER_CURRENT_MAX}
							step={0.1}
							value={current}
							onChange={(event) => {
								setCurrent(event.target.value);
								markEdited(measured);
							}}
							onBlur={() => setCurrent(String(currentA))}
							className={FIELD_INPUT}
						/>
					</label>

					<div className="block">
						<label>
							<span className={FIELD_LABEL}>{t("rating.power")}</span>
							<input
								type="number"
								inputMode="numeric"
								min={STICKER_POWER_MIN}
								max={STICKER_POWER_MAX}
								step={1}
								value={powerOverride ? power : String(computedPower)}
								onChange={(event) => {
									setPower(event.target.value);
									markEdited(measured);
								}}
								onBlur={() => setPower(String(powerVA))}
								disabled={!powerOverride}
								className={FIELD_INPUT}
							/>
						</label>
						<label className="mt-2 flex items-center gap-2 text-xs font-bold text-[#3D5568]">
							<input
								type="checkbox"
								checked={powerOverride}
								onChange={(event) => {
									const next = event.target.checked;
									setPowerOverride(next);
									setPower(String(computedPower));
									markEdited(measured);
								}}
								className="size-4 rounded border-[#C9D6E5] text-[#E85A2A] focus:ring-[#E85A2A]"
							/>
							{t("rating.powerOverride")}
						</label>
						<span className={FIELD_HINT}>{t("rating.powerHint")}</span>
					</div>
				</div>

				<div className="flex flex-wrap items-end gap-4">
					<label className="flex items-center gap-2 text-sm font-bold text-[#0A3D62]">
						<input
							type="checkbox"
							checked={measured}
							onChange={(event) => {
								const next = event.target.checked;
								setMeasured(next);
								if (next && measuredAt === "") setMeasuredAt(todayIso());
								markEdited(next);
							}}
							className="size-4 rounded border-[#C9D6E5] text-[#E85A2A] focus:ring-[#E85A2A]"
						/>
						{t("rating.measured")}
					</label>

					<label className="block">
						<span className={FIELD_LABEL}>{t("rating.measuredOn")}</span>
						<input
							type="date"
							value={measuredAt}
							max={todayIso()}
							disabled={!measured}
							onChange={(event) => {
								setMeasuredAt(event.target.value);
								markEdited(true);
							}}
							className={FIELD_INPUT}
						/>
					</label>

					{dirty && (
						<button
							type="button"
							onClick={() => resetToRating(fallback, fallback.source)}
							className={SECONDARY_BUTTON}
						>
							{t("rating.clear")}
						</button>
					)}
					<p className="max-w-md text-[11px] leading-snug text-[#3D5568]">{t("rating.perPrint")}</p>
				</div>

				<div aria-live="polite">
					{source === "measured" ? (
						<div className={NOTE_BOX}>
							<p className="font-black">{t("warning.measuredTitle")}</p>
							<p>
								{measuredDate
									? t("warning.measuredBody", { date: measuredDate })
									: t("warning.measuredNoDate")}
							</p>
							<p className="mt-1">{t("verifyPower", { power: powerVA, unit: "VA" })}</p>
						</div>
					) : source === "entered" ? (
						<div className={WARNING_BOX}>
							<p className="font-black text-[#8A4A00]">{t("warning.enteredTitle")}</p>
							<p>
								{t("warning.enteredBody", {
									role: enteredBy === "platform" ? platformAdminRoleLabel : actorRoleLabel,
								})}
							</p>
							<p className="mt-1 text-[#3D5568]">{t("warning.enteredHint")}</p>
							<p className="mt-1">{t("verifyPower", { power: powerVA, unit: "VA" })}</p>
						</div>
					) : (
						<div className={WARNING_BOX}>
							<p>
								<b className="text-[#8A4A00]">{t("verifyTitle")}</b>{" "}
								{t("verifyIntro", {
									volts: voltageV,
									hz: frequencyHz,
									amps: currentA,
								})}
							</p>
							<ul className="mt-2 list-disc space-y-1 pl-5">
								<li>{t("verifyReadLabels")}</li>
								<li>{t("verifyMeasure")}</li>
								<li>{t("verifyPower", { power: powerVA, unit: "VA" })}</li>
							</ul>
						</div>
					)}
				</div>

				{canSaveDefault && (
					<div className="rounded-xl border border-[#C9D6E5] bg-[#F7FAFD] p-4">
						<p className="text-sm font-black text-[#0A3D62]">{t("rating.defaultTitle")}</p>
						<p className="mt-1 text-sm text-[#3D5568]">{t("rating.defaultBody")}</p>
						<label className="mt-3 block max-w-md">
							<span className={FIELD_LABEL}>{t("rating.reason")}</span>
							<input
								type="text"
								required
								minLength={10}
								maxLength={500}
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								placeholder={t("rating.defaultBody")}
								className={FIELD_INPUT}
							/>
							<span className={FIELD_HINT}>{t("rating.reasonHint")}</span>
						</label>
						<div className="mt-3 flex flex-wrap gap-2">
							<button
								type="button"
								onClick={handleSaveDefault}
								disabled={pending !== null}
								className={PRIMARY_BUTTON}
							>
								{pending === "save" && (
									<Loader2 className="size-4 animate-spin" aria-hidden="true" />
								)}
								{pending === "save" ? t("rating.saving") : t("rating.save")}
							</button>
							<button
								type="button"
								onClick={handleResetDefault}
								disabled={pending !== null}
								className={SECONDARY_BUTTON}
							>
								{pending === "reset" && (
									<Loader2 className="size-4 animate-spin" aria-hidden="true" />
								)}
								{t("rating.reset")}
							</button>
						</div>
					</div>
				)}
			</section>

			<div className="overflow-x-auto print:overflow-visible">
				<div className="mx-auto w-fit print:mx-0">
					{sheets.map((sheet) => (
						<div
							key={sheet.map((device) => device.id).join("|")}
							className="pk-page mb-6 print:mb-0"
						>
							<div className="pk-sheet">
								{sheet.map((device) => (
									<DeviceSticker
										key={device.id}
										mac={device.mac}
										strings={stickerStrings}
										rating={rating}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			</div>
		</>
	);
}
