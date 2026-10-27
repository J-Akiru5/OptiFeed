"use client";

import { useRouter } from "@/i18n/routing";
import { createPondEvent, deletePondEvent, updatePondEvent } from "@/lib/actions/pond-event";
import { EVENT_COLOR_PALETTE, EVENT_TYPE_COLORS } from "@/lib/calendar/event-colors";
import type { CalendarEventDto } from "@/lib/crop-cycle/calendar";
import { addDays, todayDateOnly } from "@/lib/crop-cycle/dates";
import type { PondOption } from "@/lib/crop-cycle/types";
import { CalendarClock, CheckSquare, Loader2, Palette, Repeat, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Modal } from "./modal";

const MANUAL_TYPES = ["MAINTENANCE", "SAMPLING", "HARVEST_PLANNED", "STOCKING", "OTHER"] as const;

type ManualType = (typeof MANUAL_TYPES)[number];
type ItemKind = "EVENT" | "TASK";
type RepeatChoice = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";

export interface EventEditorSelection {
	/** `YYYY-MM-DD` for an all-day selection, `YYYY-MM-DDTHH:mm` otherwise. */
	start: string;
	/** Exclusive end from FullCalendar. */
	end: string | null;
	allDay: boolean;
}

interface EventEditorProps {
	open: boolean;
	onClose: () => void;
	onSaved: () => void;
	pondId: string;
	ponds: PondOption[];
	selection?: EventEditorSelection | null;
	event?: CalendarEventDto | null;
}

function isManualType(value: string | undefined): value is ManualType {
	return MANUAL_TYPES.includes(value as ManualType);
}

function dateOf(value: string | null | undefined, fallback: string): string {
	return value && value.length >= 10 ? value.slice(0, 10) : fallback;
}

function timeOf(value: string | null | undefined, fallback: string): string {
	return value?.includes("T") ? value.slice(11, 16) : fallback;
}

const fieldClass =
	"w-full min-h-11 rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100";
const labelClass =
	"mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400";

export function EventEditor({
	open,
	onClose,
	onSaved,
	pondId,
	ponds,
	selection,
	event,
}: EventEditorProps) {
	const t = useTranslations("dashboard.harvest.eventForm");
	const router = useRouter();
	const today = todayDateOnly();
	const editing = Boolean(event);

	const [kind, setKind] = useState<ItemKind>("EVENT");
	const [type, setType] = useState<ManualType>("MAINTENANCE");
	const [title, setTitle] = useState("");
	const [allDay, setAllDay] = useState(true);
	const [startDate, setStartDate] = useState(today);
	const [startTime, setStartTime] = useState("09:00");
	const [endDate, setEndDate] = useState("");
	const [endTime, setEndTime] = useState("10:00");
	const [dueTime, setDueTime] = useState("");
	const [color, setColor] = useState<string>("default");
	const [repeat, setRepeat] = useState<RepeatChoice>("NONE");
	const [interval, setInterval] = useState("1");
	const [until, setUntil] = useState("");
	const [remindHour, setRemindHour] = useState(false);
	const [remindDay, setRemindDay] = useState(false);
	const [notes, setNotes] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	const recurring = Boolean(event?.recurrenceFreq);
	const selectedPond = ponds.find((pond) => pond.id === pondId);

	useEffect(() => {
		if (!open) return;
		setError(null);

		if (event) {
			// Editing a series edits its anchor, not the occurrence that was clicked.
			const seriesStart = event.seriesStartsAt ?? event.start;
			const seriesEnd = event.seriesEndsAt ?? event.end;
			const eventAllDay = event.allDay;
			const eventStartDate = dateOf(seriesStart, today);
			const eventEndDate = dateOf(seriesEnd, eventStartDate);
			const eventStartTime = timeOf(seriesStart, "09:00");
			setKind(event.itemKind ?? "EVENT");
			setType(isManualType(event.kind) ? event.kind : "OTHER");
			setTitle(event.title);
			setAllDay(eventAllDay);
			setStartDate(eventStartDate);
			setStartTime(eventStartTime);
			setEndDate(seriesEnd ? eventEndDate : "");
			setEndTime(timeOf(seriesEnd, eventStartTime));
			setDueTime(eventAllDay ? "" : eventStartTime);
			setColor(event.color ?? "default");
			setRepeat((event.recurrenceFreq as RepeatChoice | null) ?? "NONE");
			setInterval(String(event.recurrenceInterval ?? 1));
			setUntil(event.recurrenceUntil ?? "");
			setRemindHour((event.reminderMinutes ?? []).includes(60));
			setRemindDay((event.reminderMinutes ?? []).includes(1440));
			setNotes(event.notes ?? "");
			return;
		}

		const initial = selection;
		const initialAllDay = initial?.allDay ?? true;
		const initialStartDate = dateOf(initial?.start, today);
		const initialEndExclusive = initial?.end ? dateOf(initial.end, initialStartDate) : null;
		setKind("EVENT");
		setType("MAINTENANCE");
		setTitle("");
		setAllDay(initialAllDay);
		setStartDate(initialStartDate);
		setStartTime(timeOf(initial?.start, "09:00"));
		// FullCalendar's all-day end is exclusive; the editor stores the last day.
		setEndDate(
			initialEndExclusive && initialAllDay
				? addDays(initialEndExclusive, -1) > initialStartDate
					? addDays(initialEndExclusive, -1)
					: ""
				: initialEndExclusive && initialEndExclusive > initialStartDate
					? initialEndExclusive
					: "",
		);
		setEndTime(timeOf(initial?.end, addHoursToTime(timeOf(initial?.start, "09:00"), 1)));
		setDueTime("");
		setColor("default");
		setRepeat("NONE");
		setInterval("1");
		setUntil("");
		setRemindHour(false);
		setRemindDay(false);
		setNotes("");
	}, [open, event, selection, today]);

	const effectiveAllDay = kind === "TASK" ? !dueTime : allDay;
	const previewColor = color === "default" ? EVENT_TYPE_COLORS[type] : color;

	const typeOptions = useMemo(
		() =>
			MANUAL_TYPES.map((value) => ({
				value,
				label: t(
					value === "MAINTENANCE"
						? "typeMaintenance"
						: value === "SAMPLING"
							? "typeSampling"
							: value === "HARVEST_PLANNED"
								? "typeHarvestPlanned"
								: value === "STOCKING"
									? "typeStocking"
									: "typeOther",
				),
			})),
		[t],
	);

	const buildPayload = () => {
		const startsAt =
			kind === "TASK"
				? dueTime
					? `${startDate}T${dueTime}`
					: startDate
				: allDay
					? startDate
					: `${startDate}T${startTime}`;
		let endsAt: string | null = null;
		if (kind === "EVENT" && endDate) {
			const candidate = allDay ? endDate : `${endDate}T${endTime}`;
			if (candidate !== startsAt) endsAt = candidate;
		}
		const reminderMinutes: (60 | 1440)[] = [];
		if (remindHour) reminderMinutes.push(60);
		if (remindDay) reminderMinutes.push(1440);
		return {
			kind,
			type,
			title: title.trim(),
			allDay: effectiveAllDay,
			startsAt,
			endsAt,
			color: color === "default" ? null : color,
			recurrence:
				repeat === "NONE"
					? null
					: {
							freq: repeat,
							interval: Number.parseInt(interval, 10) || 1,
							until: until || null,
						},
			reminderMinutes,
			notes: notes.trim() || null,
		};
	};

	const submit = () => {
		setError(null);
		if (!title.trim()) {
			setError(t("titleError"));
			return;
		}
		const payload = buildPayload();

		startTransition(async () => {
			const result = event
				? await updatePondEvent({
						id: event.pondEventId ?? event.id.replace(/^pond:/, "").split(":")[0],
						...payload,
					})
				: await createPondEvent({ pondId, ...payload });
			if (!result.success) {
				setError(result.error);
				return;
			}
			toast.success(editing ? t("successUpdate") : t("successCreate"));
			router.refresh();
			onSaved();
			onClose();
		});
	};

	const remove = () => {
		if (!event) return;
		const confirmMessage = recurring ? t("deleteSeriesConfirm") : t("deleteConfirm");
		if (!window.confirm(confirmMessage)) return;
		setError(null);
		startTransition(async () => {
			const result = await deletePondEvent({
				id: event.pondEventId ?? event.id.replace(/^pond:/, "").split(":")[0],
			});
			if (!result.success) {
				setError(result.error);
				return;
			}
			toast.success(t("successDelete"));
			router.refresh();
			onSaved();
			onClose();
		});
	};

	return (
		<Modal
			open={open}
			side="right"
			size="lg"
			onClose={isPending ? () => undefined : onClose}
			title={editing ? t("titleEdit") : t("titleNew")}
			description={selectedPond ? t("descPond", { pond: selectedPond.name }) : t("desc")}
			footer={
				<div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div>
						{event && (
							<button
								type="button"
								onClick={remove}
								disabled={isPending}
								className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30"
							>
								<Trash2 className="h-4 w-4" aria-hidden="true" />
								{t("delete")}
							</button>
						)}
					</div>
					<div className="flex flex-col-reverse gap-2 sm:flex-row">
						<button
							type="button"
							onClick={onClose}
							disabled={isPending}
							className="min-h-11 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
						>
							{t("cancel")}
						</button>
						<button
							type="button"
							onClick={submit}
							disabled={isPending}
							className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#164e7c] disabled:opacity-50 dark:bg-[#1f66a0]"
						>
							{isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
							{isPending ? t("saving") : t("save")}
						</button>
					</div>
				</div>
			}
		>
			<div className="space-y-5">
				<fieldset className="m-0 border-0 p-0">
					<legend className={labelClass}>{t("kind")}</legend>
					<div className="grid grid-cols-2 gap-2">
						{(["EVENT", "TASK"] as const).map((value) => (
							<button
								key={value}
								type="button"
								onClick={() => setKind(value)}
								aria-pressed={kind === value}
								className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors ${
									kind === value
										? "border-[#0A3D62] bg-[#0A3D62] text-white dark:border-[#1f66a0] dark:bg-[#1f66a0]"
										: "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
								}`}
							>
								{value === "EVENT" ? (
									<CalendarClock className="h-4 w-4" aria-hidden="true" />
								) : (
									<CheckSquare className="h-4 w-4" aria-hidden="true" />
								)}
								{value === "EVENT" ? t("kindEvent") : t("kindTask")}
							</button>
						))}
					</div>
				</fieldset>

				<div className="grid gap-3 sm:grid-cols-2">
					<label className="block">
						<span className={labelClass}>{t("type")}</span>
						<select
							value={type}
							onChange={(change) => setType(change.target.value as ManualType)}
							className={fieldClass}
						>
							{typeOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<div className="flex items-end">
						<p className="inline-flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-xs font-semibold text-gray-500 dark:border-gray-700/60 dark:bg-gray-800/60 dark:text-gray-400">
							<span
								aria-hidden="true"
								className="h-3 w-3 rounded-full"
								style={{ backgroundColor: previewColor }}
							/>
							{t("colorPreview")}
						</p>
					</div>
				</div>

				<label className="block">
					<span className={labelClass}>{t("title")}</span>
					<input
						value={title}
						onChange={(change) => setTitle(change.target.value)}
						maxLength={80}
						placeholder={t("titlePlaceholder")}
						className={fieldClass}
					/>
				</label>

				{kind === "EVENT" && (
					<label className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-100 bg-gray-50/70 px-3 text-sm font-bold text-gray-700 dark:border-gray-700/60 dark:bg-gray-800/50 dark:text-gray-200">
						<input
							type="checkbox"
							checked={allDay}
							onChange={(change) => setAllDay(change.target.checked)}
							className="h-5 w-5 accent-[#0A3D62]"
						/>
						{t("allDay")}
					</label>
				)}

				{kind === "TASK" ? (
					<div className="grid gap-3 sm:grid-cols-2">
						<label className="block">
							<span className={labelClass}>{t("dueDate")}</span>
							<input
								type="date"
								value={startDate}
								onChange={(change) => setStartDate(change.target.value)}
								className={fieldClass}
							/>
						</label>
						<label className="block">
							<span className={labelClass}>{t("dueTime")}</span>
							<input
								type="time"
								value={dueTime}
								onChange={(change) => setDueTime(change.target.value)}
								className={fieldClass}
							/>
						</label>
					</div>
				) : allDay ? (
					<div className="grid gap-3 sm:grid-cols-2">
						<label className="block">
							<span className={labelClass}>{t("startDate")}</span>
							<input
								type="date"
								value={startDate}
								onChange={(change) => setStartDate(change.target.value)}
								className={fieldClass}
							/>
						</label>
						<label className="block">
							<span className={labelClass}>{t("endDate")}</span>
							<input
								type="date"
								value={endDate}
								min={startDate}
								onChange={(change) => setEndDate(change.target.value)}
								className={fieldClass}
							/>
						</label>
					</div>
				) : (
					<div className="grid gap-3 sm:grid-cols-2">
						<label className="block">
							<span className={labelClass}>{t("startTimeLabel")}</span>
							<input
								type="datetime-local"
								value={`${startDate}T${startTime}`}
								onChange={(change) => {
									setStartDate(dateOf(change.target.value, startDate));
									setStartTime(timeOf(change.target.value, startTime));
								}}
								className={fieldClass}
							/>
						</label>
						<label className="block">
							<span className={labelClass}>{t("endTimeLabel")}</span>
							<input
								type="datetime-local"
								value={endDate ? `${endDate}T${endTime}` : ""}
								onChange={(change) => {
									setEndDate(dateOf(change.target.value, startDate));
									setEndTime(timeOf(change.target.value, endTime));
								}}
								className={fieldClass}
							/>
						</label>
					</div>
				)}

				<fieldset className="m-0 border-0 p-0">
					<legend className={`${labelClass} inline-flex items-center gap-1.5`}>
						<Palette className="h-3.5 w-3.5" aria-hidden="true" />
						{t("color")}
					</legend>
					<div className="flex flex-wrap items-center gap-2">
						<button
							type="button"
							onClick={() => setColor("default")}
							aria-pressed={color === "default"}
							className={`min-h-11 rounded-full border px-3 text-xs font-bold transition-colors ${
								color === "default"
									? "border-[#0A3D62] text-[#0A3D62] dark:border-[#8fc0ea] dark:text-[#8fc0ea]"
									: "border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"
							}`}
						>
							{t("colorDefault")}
						</button>
						{EVENT_COLOR_PALETTE.map((swatch) => (
							<button
								key={swatch}
								type="button"
								onClick={() => setColor(swatch)}
								aria-pressed={color.toLowerCase() === swatch.toLowerCase()}
								aria-label={t("colorSwatch", { color: swatch })}
								className={`h-11 w-11 rounded-full border-2 transition-transform ${
									color.toLowerCase() === swatch.toLowerCase()
										? "scale-105 border-[#0A3D62] dark:border-white"
										: "border-transparent"
								}`}
								style={{ backgroundColor: swatch }}
							/>
						))}
					</div>
				</fieldset>

				<fieldset className="m-0 border-0 p-0">
					<legend className={`${labelClass} inline-flex items-center gap-1.5`}>
						<Repeat className="h-3.5 w-3.5" aria-hidden="true" />
						{t("repeat")}
					</legend>
					<div className="grid gap-3 sm:grid-cols-3">
						<select
							value={repeat}
							onChange={(change) => {
								setRepeat(change.target.value as RepeatChoice);
								if (change.target.value === "NONE") setUntil("");
							}}
							aria-label={t("repeat")}
							className={fieldClass}
						>
							<option value="NONE">{t("repeatNone")}</option>
							<option value="DAILY">{t("repeatDaily")}</option>
							<option value="WEEKLY">{t("repeatWeekly")}</option>
							<option value="MONTHLY">{t("repeatMonthly")}</option>
						</select>
						<label className="block">
							<span className="sr-only">{t("repeatInterval")}</span>
							<input
								type="number"
								min={1}
								max={52}
								value={interval}
								disabled={repeat === "NONE"}
								onChange={(change) => setInterval(change.target.value)}
								aria-label={t("repeatInterval")}
								className={fieldClass}
							/>
						</label>
						<label className="block">
							<span className="sr-only">{t("repeatUntil")}</span>
							<input
								type="date"
								value={until}
								min={startDate}
								disabled={repeat === "NONE"}
								onChange={(change) => setUntil(change.target.value)}
								aria-label={t("repeatUntil")}
								className={fieldClass}
							/>
						</label>
					</div>
					{repeat !== "NONE" && (
						<p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
							{t("repeatHint", { count: Number.parseInt(interval, 10) || 1 })}
						</p>
					)}
				</fieldset>

				<fieldset className="m-0 border-0 p-0">
					<legend className={labelClass}>{t("reminders")}</legend>
					<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
						<label className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-100 bg-gray-50/70 px-3 text-sm font-bold text-gray-700 dark:border-gray-700/60 dark:bg-gray-800/50 dark:text-gray-200">
							<input
								type="checkbox"
								checked={remindHour}
								onChange={(change) => setRemindHour(change.target.checked)}
								className="h-5 w-5 accent-[#0A3D62]"
							/>
							{t("reminderHour")}
						</label>
						<label className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-100 bg-gray-50/70 px-3 text-sm font-bold text-gray-700 dark:border-gray-700/60 dark:bg-gray-800/50 dark:text-gray-200">
							<input
								type="checkbox"
								checked={remindDay}
								onChange={(change) => setRemindDay(change.target.checked)}
								className="h-5 w-5 accent-[#0A3D62]"
							/>
							{t("reminderDay")}
						</label>
					</div>
				</fieldset>

				<label className="block">
					<span className={labelClass}>{t("notes")}</span>
					<textarea
						value={notes}
						onChange={(change) => setNotes(change.target.value)}
						rows={3}
						maxLength={1_000}
						placeholder={t("notesPlaceholder")}
						className={fieldClass}
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

function addHoursToTime(value: string, hours: number): string {
	const [hour = "9", minute = "00"] = value.split(":");
	const next = (Number.parseInt(hour, 10) + hours) % 24;
	return `${String(next).padStart(2, "0")}:${minute}`;
}
