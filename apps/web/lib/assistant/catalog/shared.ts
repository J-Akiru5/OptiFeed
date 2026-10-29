import { updateScheduleCommand } from "@/lib/actions/schedule";
import { updatePondSettings } from "@/lib/actions/settings";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import type { AssistantExecuteResult } from "../types";

/**
 * Helpers shared by the server-side assistant tool catalogue (issue #194, E10).
 *
 * Every catalogue entry wraps an **existing** server action. There is
 * deliberately no write logic here: the assistant must inherit the same
 * permission checks, caps, offline/fallow blocks, rate limits and audit rows as
 * the button a person would press. These helpers only resolve the current
 * pond/device and forward the validated payload.
 */

export function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function hhmm(date: Date): string {
	return date.toISOString().slice(11, 16);
}

export function fail(message: string): AssistantExecuteResult {
	return { success: false, message };
}

export async function activePondOrError(): Promise<
	{ ok: true; pond: { id: string; name: string } } | { ok: false; result: AssistantExecuteResult }
> {
	const pond = await getActivePond();
	if (!pond) return { ok: false, result: fail("No active pond is assigned to this account.") };
	return { ok: true, pond: { id: pond.id as string, name: pond.name as string } };
}

export async function activeDevice(pondId: string): Promise<{ id: string; label: string } | null> {
	const device = await prisma.energyDevice.findFirst({
		where: { pondId },
		orderBy: { createdAt: "asc" },
		select: { id: true, label: true },
	});
	return device ? { id: device.id, label: device.label } : null;
}

/**
 * Resolve the pond an action targets: the id the user named, otherwise the
 * active pond. Scope is *not* checked here — the server action re-resolves the
 * caller's organization, so an id from another tenant is refused there.
 */
export async function pondTarget(
	payload: Record<string, unknown>,
): Promise<{ ok: true; id: string; name: string } | { ok: false; result: AssistantExecuteResult }> {
	const pondId = str(payload.pondId);
	if (pondId) {
		return { ok: true, id: pondId, name: str(payload.pondName) || "the selected pond" };
	}
	const pondResult = await activePondOrError();
	if (!pondResult.ok) return pondResult;
	return { ok: true, id: pondResult.pond.id, name: pondResult.pond.name };
}

/** The name a pond card should show, without pretending a named id is the active pond. */
export function pondLabel(
	payload: Record<string, unknown>,
	context: { pondName: string | null },
): string {
	return (
		str(payload.pondName) ||
		(str(payload.pondId) ? "the selected pond" : context.pondName) ||
		"Active pond"
	);
}

/** Resolve the device an action targets: the named one, otherwise the active pond's feeder. */
export async function deviceTarget(
	payload: Record<string, unknown>,
): Promise<
	{ ok: true; id: string; label: string } | { ok: false; result: AssistantExecuteResult }
> {
	const deviceId = str(payload.deviceId);
	if (deviceId) {
		return { ok: true, id: deviceId, label: str(payload.deviceLabel) || "the selected feeder" };
	}
	const pondResult = await activePondOrError();
	if (!pondResult.ok) return pondResult;
	const device = await activeDevice(pondResult.pond.id);
	if (!device) return { ok: false, result: fail("No feeder is linked to this pond yet.") };
	return { ok: true, id: device.id, label: device.label };
}

/**
 * Change one value of the schedule while keeping the rest as it is. This is
 * the exact call ScheduleEditor makes; the server revalidates the whole
 * schedule (caps, fallow, device limit) in `updateScheduleCommand`.
 */
export async function changeSchedule(patch: {
	feedsPerDay?: number;
	feedingRatePct?: number;
}): Promise<AssistantExecuteResult> {
	const pondResult = await activePondOrError();
	if (!pondResult.ok) return pondResult.result;
	const { pond } = pondResult;

	const device = await activeDevice(pond.id);
	const current = await resolveCurrentSchedule(pond.id, device?.id ?? null);
	const rate = patch.feedingRatePct ?? current?.feedingRatePct;
	const feeds = patch.feedsPerDay ?? current?.feedsPerDay;
	if (rate === undefined || feeds === undefined) {
		return fail("The current feeding schedule could not be read.");
	}

	if (!device) {
		// No feeder paired yet: the pond settings page is the control a person
		// would use, and it validates the same numbers.
		const result = await updatePondSettings(pond.id, rate, feeds);
		return result.success
			? {
					success: true,
					message: `Saved: ${feeds} meals/day at ${rate}% of body weight.`,
				}
			: fail(result.error ?? "Could not save the feeding settings.");
	}

	const result = await updateScheduleCommand(pond.id, device.id, {
		scheduleStart: current ? hhmm(current.scheduleStart) : "06:00",
		scheduleEnd: current ? hhmm(current.scheduleEnd) : "18:00",
		feedsPerDay: feeds,
		feedingRatePct: rate,
	});
	return result.success
		? { success: true, message: `Saved: ${feeds} meals/day at ${rate}% of body weight.` }
		: fail(result.error ?? "Could not save the feeding schedule.");
}

/** The rate/feeds value is persisted on the pond; read it for the card. */
export async function pondSettings(): Promise<{
	pond: { id: string; name: string } | null;
	feedsPerDay: number | null;
	feedingRatePct: number | null;
}> {
	const pond = await getActivePond();
	if (!pond) return { pond: null, feedsPerDay: null, feedingRatePct: null };
	const row = await prisma.pond.findUnique({
		where: { id: pond.id },
		select: { feedsPerDay: true, feedingRatePct: true },
	});
	return {
		pond: { id: pond.id as string, name: pond.name as string },
		feedsPerDay: row?.feedsPerDay ?? null,
		feedingRatePct: row?.feedingRatePct ?? null,
	};
}
