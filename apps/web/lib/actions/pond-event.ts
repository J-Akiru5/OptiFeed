"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { dateOnlyToUtcDate } from "@/lib/crop-cycle/dates";
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
	revalidatePath("/[locale]/(dashboard)/dashboard/harvest", "page");
	revalidatePath("/[locale]/(dashboard)/dashboard", "page");
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
	const ownerId = await getCurrentPondOwnerId();

	const pond = await prisma.pond.findFirst({
		where: { id: data.pondId, ownerId },
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
				type: data.type,
				status: "PLANNED",
				title: data.title,
				startsAt: dateOnlyToUtcDate(data.startsAt),
				allDay: true,
				notes: data.notes ?? null,
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
	const ownerId = await getCurrentPondOwnerId();

	const existing = await prisma.pondEvent.findFirst({
		where: { id: data.id, pond: { ownerId } },
		select: { id: true, source: true, type: true },
	});
	if (!existing) return { success: false, error: "Event not found." };
	if (existing.source !== "manual") {
		return { success: false, error: "Cycle events cannot be edited from the calendar." };
	}

	try {
		await prisma.pondEvent.update({
			where: { id: existing.id },
			data: {
				title: data.title,
				startsAt: dateOnlyToUtcDate(data.startsAt),
				notes: data.notes ?? null,
			},
		});
		revalidateCalendar();
		return { success: true, eventId: existing.id };
	} catch (error) {
		console.error("[pond-event] updatePondEvent failed:", error);
		return { success: false, error: "Could not update the pond event." };
	}
}

export async function completePondEvent(input: { id: string }): Promise<PondEventActionResult> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_crop_cycle");
	} catch {
		return { success: false, error: "You do not have permission to manage pond events." };
	}

	const parsed = completePondEventSchema.safeParse(input);
	if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
	const ownerId = await getCurrentPondOwnerId();

	const existing = await prisma.pondEvent.findFirst({
		where: { id: parsed.data.id, pond: { ownerId } },
		select: { id: true, source: true },
	});
	if (!existing) return { success: false, error: "Event not found." };
	if (existing.source !== "manual") {
		return { success: false, error: "Cycle events are completed from the cycle actions." };
	}

	try {
		await prisma.pondEvent.update({
			where: { id: existing.id },
			data: { status: "DONE", completedBy: ownerId, completedAt: new Date() },
		});
		revalidateCalendar();
		return { success: true, eventId: existing.id };
	} catch (error) {
		console.error("[pond-event] completePondEvent failed:", error);
		return { success: false, error: "Could not complete the pond event." };
	}
}

export async function deletePondEvent(input: { id: string }): Promise<PondEventActionResult> {
	try {
		await requireWriteAccess();
		await requirePermission("manage_crop_cycle");
	} catch {
		return { success: false, error: "You do not have permission to manage pond events." };
	}

	const parsed = deletePondEventSchema.safeParse(input);
	if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
	const ownerId = await getCurrentPondOwnerId();

	const existing = await prisma.pondEvent.findFirst({
		where: { id: parsed.data.id, pond: { ownerId } },
		select: { id: true, source: true },
	});
	if (!existing) return { success: false, error: "Event not found." };
	if (existing.source !== "manual") {
		return { success: false, error: "Cycle events cannot be deleted." };
	}

	try {
		await prisma.pondEvent.delete({ where: { id: existing.id } });
		revalidateCalendar();
		return { success: true, eventId: existing.id };
	} catch (error) {
		console.error("[pond-event] deletePondEvent failed:", error);
		return { success: false, error: "Could not delete the pond event." };
	}
}
