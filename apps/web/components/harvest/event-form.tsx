"use client";

import { useRouter } from "@/i18n/routing";
import { createPondEvent, deletePondEvent, updatePondEvent } from "@/lib/actions/pond-event";
import type { CalendarEventDto } from "@/lib/crop-cycle/calendar";
import { todayDateOnly } from "@/lib/crop-cycle/dates";
import { Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Modal } from "./modal";

interface EventFormProps {
	open: boolean;
	onClose: () => void;
	onSaved: () => void;
	pondId: string;
	date?: string;
	event?: CalendarEventDto | null;
}

export function EventForm({ open, onClose, onSaved, pondId, date, event }: EventFormProps) {
	const t = useTranslations("dashboard.harvest.eventForm");
	const router = useRouter();
	const [type, setType] = useState<"MAINTENANCE" | "OTHER">("MAINTENANCE");
	const [title, setTitle] = useState("");
	const [startsAt, setStartsAt] = useState(date ?? todayDateOnly());
	const [notes, setNotes] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	useEffect(() => {
		if (!open) return;
		const manualKind =
			event?.kind === "MAINTENANCE" || event?.kind === "OTHER" ? event.kind : "MAINTENANCE";
		setType(manualKind);
		setTitle(event?.title ?? "");
		setStartsAt(event?.start ?? date ?? todayDateOnly());
		setNotes(event?.notes ?? "");
		setError(null);
	}, [open, event, date]);

	const submit = () => {
		setError(null);
		if (!title.trim()) {
			setError(t("titleError"));
			return;
		}

		startTransition(async () => {
			const result = event
				? await updatePondEvent({
						id: event.id.replace(/^pond:/, ""),
						title: title.trim(),
						startsAt,
						notes: notes.trim() || null,
					})
				: await createPondEvent({
						pondId,
						type,
						title: title.trim(),
						startsAt,
						notes: notes.trim() || null,
					});
			if (!result.success) {
				setError(result.error);
				return;
			}
			toast.success(event ? t("successUpdate") : t("successCreate"));
			router.refresh();
			onSaved();
			onClose();
		});
	};

	const remove = () => {
		if (!event) return;
		if (!window.confirm(t("deleteConfirm"))) return;
		setError(null);
		startTransition(async () => {
			const result = await deletePondEvent({ id: event.id.replace(/^pond:/, "") });
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
			onClose={isPending ? () => undefined : onClose}
			title={event ? t("titleEdit") : t("titleNew")}
			description={t("desc")}
			footer={
				<div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div>
						{event && (
							<button
								type="button"
								onClick={remove}
								disabled={isPending}
								className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30"
							>
								<Trash2 className="h-4 w-4" />
								{t("delete")}
							</button>
						)}
					</div>
					<div className="flex flex-col-reverse gap-2 sm:flex-row">
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
				</div>
			}
		>
			<div className="space-y-4">
				{!event && (
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("type")}
						</span>
						<select
							value={type}
							onChange={(event) => setType(event.target.value as "MAINTENANCE" | "OTHER")}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						>
							<option value="MAINTENANCE">{t("typeMaintenance")}</option>
							<option value="OTHER">{t("typeOther")}</option>
						</select>
					</label>
				)}

				<label className="block">
					<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
						{t("title")}
					</span>
					<input
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						maxLength={80}
						placeholder={t("titlePlaceholder")}
						className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] placeholder:text-gray-400 focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
					/>
				</label>

				<label className="block">
					<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
						{t("date")}
					</span>
					<input
						type="date"
						value={startsAt}
						onChange={(event) => setStartsAt(event.target.value)}
						className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
					/>
				</label>

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
