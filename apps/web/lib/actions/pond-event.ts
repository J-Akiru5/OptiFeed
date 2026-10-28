"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { requireWriteAccess } from "@/lib/auth/session";
import { farmDateTimeToUtcDate, utcDateToFarmDateTime } from "@/lib/calendar/datetime";
import { expandOccurrences } from "@/lib/calendar/recurrence";
import {
	resolveCalendarWriteScope,
	writablePondEventWhere,
	writablePondWhere,
} from "@/lib/calendar/write-scope";
import { dateOnlyToUtcDate, dateToFarmDateOnly } from "@/lib/crop-cycle/dates";
import {
	type PondEventInput,
	type UpdatePondEventInput,
	completePondEventSchema,
	deletePondEventSchema,
	pondEventInputSchema,
	updatePondEventSchema,
} from "@/lib/crop-cycle/schema";
import { formatZodError } from "@/lib/limits";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export type PondEventActionResult =
	| { success: true; eventId: string }
	| { success: false; error: string };

function revalidateCalendar(): void {
	revalidatePath("/[locale]/(dashboard)/dashboard/calendar", "page");
	revalidatePath("/[locale]/(dashboard)/dashboard/calendar", "page");
	revalidatePath("/[locale]/(dashboard)/dashboard", "page");
	revalidatePath("/[locale]/(admin)/admin/calendar", "page");
}

/** The farm-local value the API and the editor agree on. */
function toStoredMoment(value: string): Date {
	return farmDateTimeToUtcDate(value);
}

function toStoredRecurrenceUntil(value: string | null | undefined): Date | null {
	return value ? dateOnlyToUtcDate(value) : null;
}

/**
 * Validate that a completion/skip occurrence belongs to the stored series.
 * Without this a caller could append arbitrary timestamps to
 * `completedOccurrences`.
 */
function occurrenceBelongsToSeries(
	occurrence: string,
	event: {
		startsAt: Date;
		allDay: boolean;
		recurrenceFreq: "DAILY" | "WEEKLY" | "MONTHLY" | null;
		recurrenceInterval: number;
		recurrenceUntil: Date | null;
	},
): boolean {
	const instant = new Date(occurrence);
	if (Number.isNaN(instant.getTime())) return false;
	if (!event.recurrenceFreq) return false;

	const anchor = event.allDay
		? event.startsAt.toISOString().slice(0, 10)
		: utcDateToFarmDateTime(event.startsAt);
	const until = event.recurrenceUntil?.toISOString().slice(0, 10) ?? null;
	const occurrenceDate = dateToFarmDateOnly(instant);
	const anchorDate = anchor.slice(0, 10);
	if (occurrenceDate < anchorDate) return false;
	if (until && occurrenceDate > until) return false;

	const { occurrences } = expandOccurrences({
		start: anchor,
		end: null,
		allDay: event.allDay,
		recurrence: {
			freq: event.recurrenceFreq,
			interval: event.recurrenceInterval,
			until,
		},
		window: { from: occurrenceDate, to: occurrenceDate },
	});
	return occurrences.some((item) => item.occurrenceKey === instant.toISOString());
}

export async function createPondEvent(input: PondEventInput): Promise<PondEventActionResult> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_crop_cycle");
	} catch {
		return { success: false, error: "You do not have permission to manage pond events." };
	}

	const parsed = pondEventInputSchema.safeParse(input);
	if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
	const data = parsed.data;
	const scope = await resolveCalendarWriteScope();
	const ownerId = scope.ownerId;

	const pond = await prisma.pond.findFirst({
		where: { id: data.pondId, ...writablePondWhere(scope) },
		select: { id: true, farmId: true },
	});
	if (!pond) return { success: false, error: "Pond not found." };

	if (data.cropCycleId) {
		const cycle = await prisma.cropCycle.findFirst({
			where: { id: data.cropCycleId, pondId: pond.id },
			select: { id: true },
		});
		if (!cycle) return { success: false, error: "Grow-out cycle not found for this pond." };
	}

	try {
		const event = await prisma.pondEvent.create({
			data: {
				pondId: pond.id,
				cropCycleId: data.cropCycleId ?? null,
				farmId: pond.farmId,
				kind: data.kind,
				type: data.type,
				status: "PLANNED",
				title: data.title,
				startsAt: toStoredMoment(data.startsAt),
				endsAt: data.endsAt ? toStoredMoment(data.endsAt) : null,
				allDay: data.allDay,
				notes: data.notes ?? null,
				color: data.color ?? null,
				recurrenceFreq: data.recurrence?.freq ?? null,
				recurrenceInterval: data.recurrence?.interval ?? 1,
				recurrenceUntil: toStoredRecurrenceUntil(data.recurrence?.until),
				reminderMinutes: data.reminderMinutes ?? [],
				source: "manual",
				createdBy: ownerId,
			},
		});
		revalidateCalendar();
		return { success: true, eventId: event.id };
	} catch (error) {
		console.error("[pond-event] createPondEvent failed:", error);
		return { success: false, error: "Could not add the pond event." };
	}
}

export async function updatePondEvent(input: UpdatePondEventInput): Promise<PondEventActionResult> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_crop_cycle");
	} catch {
		return { success: false, error: "You do not have permission to manage pond events." };
	}

	const parsed = updatePondEventSchema.safeParse(input);
	if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
	const data = parsed.data;
	const scope = await resolveCalendarWriteScope();

	const existing = await prisma.pondEvent.findFirst({
		where: { id: data.id, ...writablePondEventWhere(scope) },
		select: {
			id: true,
			source: true,
			type: true,
			kind: true,
			allDay: true,
			startsAt: true,
			endsAt: true,
			recurrenceFreq: true,
		},
	});
	if (!existing) return { success: false, error: "Event not found." };
	if (existing.source !== "manual") {
		return { success: false, error: "Cycle events cannot be edited from the calendar." };
	}

	// Build a patch so a drag/resize that only moves the item cannot silently
	// clear its title, notes, colour, reminders or recurrence.
	const patch: Record<string, unknown> = {};
	if (data.title !== undefined) patch.title = data.title;
	if (data.kind !== undefined) patch.kind = data.kind;
	if (data.type !== undefined) patch.type = data.type;
	if (data.allDay !== undefined) patch.allDay = data.allDay;
	if (data.startsAt !== undefined) patch.startsAt = toStoredMoment(data.startsAt);
	if (data.endsAt !== undefined) {
		patch.endsAt = data.endsAt ? toStoredMoment(data.endsAt) : null;
	}
	if (data.color !== undefined) patch.color = data.color;
	if (data.notes !== undefined) patch.notes = data.notes;
	if (data.reminderMinutes !== undefined) patch.reminderMinutes = data.reminderMinutes;
	if (data.recurrence !== undefined) {
		patch.recurrenceFreq = data.recurrence?.freq ?? null;
		patch.recurrenceInterval = data.recurrence?.interval ?? 1;
		patch.recurrenceUntil = toStoredRecurrenceUntil(data.recurrence?.until);
	}

	// The effective range must stay valid after a partial update.
	const effectiveStart = (patch.startsAt as Date | undefined) ?? new Date(existing.startsAt);
	const effectiveEnd =
		patch.endsAt !== undefined ? (patch.endsAt as Date | null) : (existing.endsAt ?? null);
	if (effectiveEnd && effectiveEnd.getTime() < effectiveStart.getTime()) {
		return { success: false, error: "The end must be after the start." };
	}

	try {
		await prisma.pondEvent.update({ where: { id: existing.id }, data: patch });
		revalidateCalendar();
		return { success: true, eventId: existing.id };
	} catch (error) {
		console.error("[pond-event] updatePondEvent failed:", error);
		return { success: false, error: "Could not update the pond event." };
	}
}

export async function completePondEvent(input: {
	id: string;
	occurrence?: string | null;
}): Promise<PondEventActionResult> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_crop_cycle");
	} catch {
		return { success: false, error: "You do not have permission to manage pond events." };
	}

	const parsed = completePondEventSchema.safeParse(input);
	if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
	const scope = await resolveCalendarWriteScope();
	const ownerId = scope.ownerId;

	const existing = await prisma.pondEvent.findFirst({
		where: { id: parsed.data.id, ...writablePondEventWhere(scope) },
		select: {
			id: true,
			source: true,
			startsAt: true,
			allDay: true,
			recurrenceFreq: true,
			recurrenceInterval: true,
			recurrenceUntil: true,
			completedOccurrences: true,
		},
	});
	if (!existing) return { success: false, error: "Event not found." };
	if (existing.source !== "manual") {
		return { success: false, error: "Cycle events are completed from the cycle actions." };
	}

	const occurrence = parsed.data.occurrence;
	if (occurrence && !occurrenceBelongsToSeries(occurrence, existing)) {
		return { success: false, error: "That occurrence is not part of this series." };
	}

	try {
		if (occurrence) {
			const key = new Date(occurrence).toISOString();
			const alreadyDone = existing.completedOccurrences.some(
				(value) => value.toISOString() === key,
			);
			if (!alreadyDone) {
				await prisma.pondEvent.update({
					where: { id: existing.id },
					data: {
						completedOccurrences: {
							set: [...existing.completedOccurrences, new Date(key)],
						},
					},
				});
			}
		} else {
			await prisma.pondEvent.update({
				where: { id: existing.id },
				data: { status: "DONE", completedBy: ownerId, completedAt: new Date() },
			});
		}
		revalidateCalendar();
		return { success: true, eventId: existing.id };
	} catch (error) {
		console.error("[pond-event] completePondEvent failed:", error);
		return { success: false, error: "Could not complete the pond event." };
	}
}

/** Undo a mistaken task check. */
export async function uncompletePondEvent(input: {
	id: string;
	occurrence?: string | null;
}): Promise<PondEventActionResult> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_crop_cycle");
	} catch {
		return { success: false, error: "You do not have permission to manage pond events." };
	}

	const parsed = completePondEventSchema.safeParse(input);
	if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
	const scope = await resolveCalendarWriteScope();
	const ownerId = scope.ownerId;

	const existing = await prisma.pondEvent.findFirst({
		where: { id: parsed.data.id, ...writablePondEventWhere(scope) },
		select: {
			id: true,
			source: true,
			startsAt: true,
			allDay: true,
			recurrenceFreq: true,
			recurrenceInterval: true,
			recurrenceUntil: true,
			completedOccurrences: true,
		},
	});
	if (!existing) return { success: false, error: "Event not found." };
	if (existing.source !== "manual") {
		return { success: false, error: "Cycle events are completed from the cycle actions." };
	}

	const occurrence = parsed.data.occurrence;
	if (occurrence && !occurrenceBelongsToSeries(occurrence, existing)) {
		return { success: false, error: "That occurrence is not part of this series." };
	}

	try {
		if (occurrence) {
			const key = new Date(occurrence).toISOString();
			await prisma.pondEvent.update({
				where: { id: existing.id },
				data: {
					completedOccurrences: {
						set: existing.completedOccurrences.filter((value) => value.toISOString() !== key),
					},
				},
			});
		} else {
			await prisma.pondEvent.update({
				where: { id: existing.id },
				data: { status: "PLANNED", completedBy: null, completedAt: null },
			});
		}
		revalidateCalendar();
		return { success: true, eventId: existing.id };
	} catch (error) {
		console.error("[pond-event] uncompletePondEvent failed:", error);
		return { success: false, error: "Could not reopen the pond event." };
	}
}

export async function deletePondEvent(input: {
	id: string;
	occurrence?: string | null;
}): Promise<PondEventActionResult> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_crop_cycle");
	} catch {
		return { success: false, error: "You do not have permission to manage pond events." };
	}

	const parsed = deletePondEventSchema.safeParse(input);
	if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
	const scope = await resolveCalendarWriteScope();

	const existing = await prisma.pondEvent.findFirst({
		where: { id: parsed.data.id, ...writablePondEventWhere(scope) },
		select: {
			id: true,
			source: true,
			startsAt: true,
			allDay: true,
			recurrenceFreq: true,
			recurrenceInterval: true,
			recurrenceUntil: true,
			completedOccurrences: true,
		},
	});
	if (!existing) return { success: false, error: "Event not found." };
	if (existing.source !== "manual") {
		return { success: false, error: "Cycle events cannot be deleted." };
	}

	const occurrence = parsed.data.occurrence;
	if (occurrence && !occurrenceBelongsToSeries(occurrence, existing)) {
		return { success: false, error: "That occurrence is not part of this series." };
	}

	try {
		if (occurrence) {
			// "Delete this occurrence" skips just that day by recording it in the
			// completed list; the series and every other occurrence stay intact.
			const key = new Date(occurrence).toISOString();
			const alreadySkipped = existing.completedOccurrences.some(
				(value) => value.toISOString() === key,
			);
			if (!alreadySkipped) {
				await prisma.pondEvent.update({
					where: { id: existing.id },
					data: {
						completedOccurrences: {
							set: [...existing.completedOccurrences, new Date(key)],
						},
					},
				});
			}
		} else {
			await prisma.pondEvent.delete({ where: { id: existing.id } });
		}
		revalidateCalendar();
		return { success: true, eventId: existing.id };
	} catch (error) {
		console.error("[pond-event] deletePondEvent failed:", error);
		return { success: false, error: "Could not delete the pond event." };
	}
}
