import { utcDateToFarmDateTime } from "@/lib/calendar/datetime";
import { expandOccurrences } from "@/lib/calendar/recurrence";
import {
	CALENDAR_EVENT_TYPES,
	type CalendarEventDto,
	type CalendarEventStatus,
	type CalendarEventType,
	pondEventCalendarType,
} from "@/lib/crop-cycle/calendar";
import { addDays, dateRangeUtc, daysBetween, formatDateOnly } from "@/lib/crop-cycle/dates";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";

/**
 * Shared source of the calendar event stream (#195/#196).
 *
 * Both the farmer calendar API (`app/api/calendar/events/route.ts`) and the
 * platform calendar (superadmin, E16.2) build their events here, so the two
 * paths can never drift: the same persisted events, sample-due derivation,
 * feeding bands, device incidents, recurrence expansion and caps apply.
 *
 * Callers scope the ponds first (owner, organization or all tenants) and pass
 * the selected pond rows in. Every source below is fetched with one range
 * query for the whole selection; the only per-pond work is pure computation.
 */

export const MAX_CALENDAR_RANGE_DAYS = 400;
export const MAX_CALENDAR_EVENTS = 1_000;
export const MAX_FEEDING_RANGE_DAYS = 62;
export const MAX_FEEDING_EVENTS = 1_500;

/** Device incident types the calendar has a title and an icon for. */
export const CALENDAR_DEVICE_EVENT_TYPES = [
	"connected",
	"disconnected",
	"command_failed",
	"pellet_low",
	"pellet_refilled",
	"schedule_changed",
	"prediction_applied",
] as const;

/** The subset the platform calendar surfaces (E16.2). */
export const PLATFORM_DEVICE_EVENT_TYPES = ["disconnected", "pellet_low"] as const;

const DEVICE_EVENT_TITLES: Record<string, string> = {
	connected: "Device reconnected",
	disconnected: "Device offline",
	command_failed: "Device command failed",
	pellet_low: "Feed level low",
	pellet_refilled: "Hopper refilled",
	schedule_changed: "Schedule changed",
	prediction_applied: "AI recommendation applied",
};

export interface CalendarEventPond {
	id: string;
	name: string;
	sampleIntervalDays: number;
	createdAt: Date;
	isFallow: boolean;
}

export interface CalendarEventLoadInput {
	/** The selected ponds, after the caller applied its pond/org scope. */
	ponds: CalendarEventPond[];
	/** Inclusive `YYYY-MM-DD` bounds. */
	from: string;
	to: string;
	/** Today in the farm timezone, for "missed" sampling status. */
	today: string;
	types: ReadonlySet<CalendarEventType>;
	/** Feeding bands need one schedule lookup per pond; those callers opt in. */
	includeFeeding?: boolean;
	deviceEventTypes?: readonly string[];
	/**
	 * Attach the creator/actor user id to persisted and device events. The
	 * farmer API does not need it; the platform calendar resolves names from it.
	 */
	includeCreatorIds?: boolean;
	/**
	 * Pond ids the caller may edit (E25, #212). Omitted means every supplied
	 * pond is writable. The farmer org calendar passes only the caller's own
	 * farm ponds, so org-wide events render read-only.
	 */
	editablePondIds?: ReadonlySet<string>;
}

export interface CalendarEventLoadResult {
	events: CalendarEventDto[];
	truncated: boolean;
}

/** The calendar default set, excluding the optional feeding background. */
export function defaultCalendarEventTypes(): CalendarEventType[] {
	return CALENDAR_EVENT_TYPES.filter((type) => type !== "feeding");
}

/**
 * Parse the `types` query parameter. An empty or fully unknown list falls back
 * to the default set (feeding is opt-in), mirroring the farmer API contract.
 */
export function parseCalendarEventTypes(raw: string | null | undefined): Set<CalendarEventType> {
	if (!raw) return new Set(defaultCalendarEventTypes());
	const requested = raw
		.split(",")
		.map((value) => value.trim())
		.filter((value): value is CalendarEventType =>
			(CALENDAR_EVENT_TYPES as readonly string[]).includes(value),
		);
	return requested.length > 0 ? new Set(requested) : new Set(defaultCalendarEventTypes());
}

export function toCalendarStatus(status: string): CalendarEventStatus {
	if (status === "DONE") return "done";
	if (status === "MISSED") return "missed";
	if (status === "CANCELLED") return "cancelled";
	return "planned";
}

function formatMinutes(totalMinutes: number): string {
	const hours = Math.floor(totalMinutes / 60) % 24;
	const minutes = totalMinutes % 60;
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export async function loadCalendarEventSources(
	input: CalendarEventLoadInput,
): Promise<CalendarEventLoadResult> {
	const { ponds, from, to, today, types } = input;
	const includeFeeding = input.includeFeeding ?? false;
	const deviceEventTypes = input.deviceEventTypes ?? CALENDAR_DEVICE_EVENT_TYPES;
	const includeCreatorIds = input.includeCreatorIds ?? false;
	const editablePondIds = input.editablePondIds;

	if (ponds.length === 0) return { events: [], truncated: false };

	const pondIds = ponds.map((pond) => pond.id);
	const pondById = new Map(ponds.map((pond) => [pond.id, pond]));
	const range = dateRangeUtc(from, to);
	const span = daysBetween(from, to);
	const events: CalendarEventDto[] = [];
	let truncated = false;

	// Persisted cycle/manual events. Recurring rows may start before the
	// visible range, so the window filters occurrences below instead of
	// dropping the row in SQL.
	if (types.has("harvest") || types.has("manual")) {
		const persisted = await prisma.pondEvent.findMany({
			where: {
				pondId: { in: pondIds },
				startsAt: { lt: range.lte },
				OR: [{ startsAt: { gte: range.gte } }, { recurrenceFreq: { not: null } }],
			},
			include: {
				pond: { select: { id: true, name: true } },
				cropCycle: { select: { label: true } },
			},
			orderBy: { startsAt: "asc" },
			take: 500,
		});

		for (const event of persisted) {
			const type = pondEventCalendarType(event.type);
			if (!types.has(type)) continue;
			const recurring = Boolean(event.recurrenceFreq);
			const anchor = event.allDay
				? formatDateOnly(event.startsAt)
				: utcDateToFarmDateTime(event.startsAt);
			const end = event.endsAt
				? event.allDay
					? formatDateOnly(event.endsAt)
					: utcDateToFarmDateTime(event.endsAt)
				: null;
			const expansion = expandOccurrences({
				start: anchor,
				end,
				allDay: event.allDay,
				recurrence: event.recurrenceFreq
					? {
							freq: event.recurrenceFreq,
							interval: event.recurrenceInterval,
							until: event.recurrenceUntil ? formatDateOnly(event.recurrenceUntil) : null,
						}
					: null,
				window: { from, to },
			});
			if (expansion.truncated) truncated = true;

			for (const occurrence of expansion.occurrences) {
				const skippedOccurrence = event.completedOccurrences.some(
					(value) => value.toISOString() === occurrence.occurrenceKey,
				);
				// "Delete this occurrence" on an Event records it in
				// completedOccurrences; hide it again. Tasks keep the checked
				// occurrence visible with a checkbox.
				if (event.kind === "EVENT" && skippedOccurrence) continue;

				const completed = event.status === "DONE" || skippedOccurrence;
				const writable = !editablePondIds || editablePondIds.has(event.pond.id);
				events.push({
					id: recurring ? `pond:${event.id}:${occurrence.occurrenceKey}` : `pond:${event.id}`,
					pondEventId: event.id,
					title: event.title,
					start: occurrence.start,
					end: occurrence.end ?? undefined,
					allDay: event.allDay,
					type,
					status: toCalendarStatus(event.status),
					kind: event.type,
					itemKind: event.kind,
					color: event.color ?? null,
					source: event.source,
					occurrenceKey: occurrence.occurrenceKey,
					recurrenceFreq: event.recurrenceFreq,
					recurrenceInterval: event.recurrenceInterval,
					recurrenceUntil: event.recurrenceUntil ? formatDateOnly(event.recurrenceUntil) : null,
					seriesStartsAt: anchor,
					seriesEndsAt: end,
					reminderMinutes: event.reminderMinutes,
					completed,
					editable:
						writable &&
						(event.source === "manual" ||
							(event.type === "HARVEST_PLANNED" && event.status === "PLANNED")),
					pondId: event.pond.id,
					pondName: event.pond.name,
					cycleLabel: event.cropCycle?.label ?? null,
					notes: event.notes,
					href: "/dashboard/harvest",
					...(includeCreatorIds ? { createdByUserId: event.createdBy } : {}),
				});
			}
		}
	}

	// Derived sampling reminders: latest sample + the pond's interval.
	if (types.has("sampling")) {
		const [latestSamples, activeCycles] = await Promise.all([
			prisma.biomassLog.groupBy({
				by: ["pondId"],
				where: { pondId: { in: pondIds } },
				_max: { recordedAt: true },
			}),
			prisma.cropCycle.findMany({
				where: { pondId: { in: pondIds }, status: "ACTIVE" },
				select: { pondId: true, stockingDate: true },
				take: 100,
			}),
		]);
		const latestByPond = new Map(
			latestSamples.map((row) => [row.pondId, row._max.recordedAt ?? null]),
		);
		const cycleByPond = new Map(activeCycles.map((row) => [row.pondId, row.stockingDate]));

		for (const pond of ponds) {
			const lastSample = latestByPond.get(pond.id) ?? cycleByPond.get(pond.id) ?? pond.createdAt;
			const interval = Math.max(1, pond.sampleIntervalDays);
			let next = addDays(formatDateOnly(lastSample), interval);
			let generated = 0;
			let guard = 0;
			while (next < from && guard < 200) {
				next = addDays(next, interval);
				guard += 1;
			}
			if (next < from) continue;
			while (next <= to && generated < 12) {
				const status: CalendarEventStatus = next < today ? "missed" : "planned";
				events.push({
					id: `sampling:${pond.id}:${next}`,
					title: "Sampling due",
					start: next,
					allDay: true,
					type: "sampling",
					status,
					editable: false,
					pondId: pond.id,
					pondName: pond.name,
					href: "/dashboard/log-sample",
				});
				next = addDays(next, interval);
				generated += 1;
			}
		}
	}

	// Derived feeding windows. These are background bands in time views and
	// are intentionally the only derived source that can be disabled.
	if (includeFeeding && types.has("feeding") && span <= MAX_FEEDING_RANGE_DAYS) {
		const devices = await prisma.energyDevice.findMany({
			where: { pondId: { in: pondIds } },
			orderBy: { createdAt: "asc" },
			select: { id: true, pondId: true, isPaused: true },
			take: 100,
		});
		const firstDeviceByPond = new Map<string, (typeof devices)[number]>();
		for (const device of devices) {
			if (device.pondId && !firstDeviceByPond.has(device.pondId)) {
				firstDeviceByPond.set(device.pondId, device);
			}
		}

		const schedules = await Promise.all(
			ponds.map(async (pond) => {
				const device = firstDeviceByPond.get(pond.id);
				const schedule = await resolveCurrentSchedule(pond.id, device?.id ?? null);
				return { pond, device, schedule };
			}),
		);

		let feedingCount = 0;
		for (const { pond, device, schedule } of schedules) {
			if (!schedule || pond.isFallow || device?.isPaused) continue;
			const startMinutes =
				schedule.scheduleStart.getUTCHours() * 60 + schedule.scheduleStart.getUTCMinutes();
			const endMinutes =
				schedule.scheduleEnd.getUTCHours() * 60 + schedule.scheduleEnd.getUTCMinutes();
			const feeds = Math.max(1, schedule.feedsPerDay);
			const step = feeds > 1 ? Math.max(0, (endMinutes - startMinutes) / (feeds - 1)) : 0;

			for (let dayOffset = 0; dayOffset <= span; dayOffset += 1) {
				const day = addDays(from, dayOffset);
				for (let feed = 0; feed < feeds; feed += 1) {
					if (feedingCount >= MAX_FEEDING_EVENTS) {
						truncated = true;
						break;
					}
					const time = formatMinutes(Math.round(startMinutes + feed * step));
					events.push({
						id: `feeding:${pond.id}:${day}:${feed}`,
						title: "Feeding",
						start: `${day}T${time}:00`,
						allDay: false,
						type: "feeding",
						status: "planned",
						editable: false,
						display: "background",
						pondId: pond.id,
						pondName: pond.name,
					});
					feedingCount += 1;
				}
				if (feedingCount >= MAX_FEEDING_EVENTS) break;
			}
		}
	}

	// Derived device/maintenance events.
	if (types.has("device")) {
		const deviceEvents = await prisma.deviceStateEvent.findMany({
			where: {
				device: { pondId: { in: pondIds } },
				eventType: { in: [...deviceEventTypes] },
				createdAt: { gte: range.gte, lt: range.lte },
			},
			include: { device: { select: { id: true, label: true, pondId: true } } },
			orderBy: { createdAt: "desc" },
			take: 200,
		});
		for (const event of deviceEvents) {
			if (!event.device.pondId) continue;
			const pond = pondById.get(event.device.pondId);
			if (!pond) continue;
			events.push({
				id: `device:${event.id}`,
				title: DEVICE_EVENT_TITLES[event.eventType] ?? "Device event",
				start: event.createdAt.toISOString(),
				allDay: false,
				type: "device",
				status: "done",
				editable: false,
				deviceEventType: event.eventType,
				pondId: pond.id,
				pondName: pond.name,
				notes: event.device.label,
				...(includeCreatorIds ? { createdByUserId: event.actorId ?? null } : {}),
			});
		}
	}

	events.sort((a, b) => a.start.localeCompare(b.start));
	if (events.length > MAX_CALENDAR_EVENTS) {
		events.length = MAX_CALENDAR_EVENTS;
		truncated = true;
	}

	return { events, truncated };
}
