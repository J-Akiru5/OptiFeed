import { ok } from "@/lib/api/envelope";
import { notFound, validationFailed } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { withAuth } from "@/lib/auth/with-auth";
import {
	CALENDAR_EVENT_TYPES,
	type CalendarEventDto,
	type CalendarEventStatus,
	type CalendarEventType,
	isCalendarEventType,
	pondEventCalendarType,
} from "@/lib/crop-cycle/calendar";
import {
	addDays,
	dateOnlyEventStart,
	dateRangeUtc,
	daysBetween,
	formatDateOnly,
	isValidDateOnly,
	todayDateOnly,
} from "@/lib/crop-cycle/dates";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";

export const dynamic = "force-dynamic";

const MAX_RANGE_DAYS = 400;
const MAX_EVENTS = 1_000;
const MAX_FEEDING_RANGE_DAYS = 62;
const MAX_FEEDING_EVENTS = 1_500;
const DEVICE_EVENT_TYPES = [
	"connected",
	"disconnected",
	"command_failed",
	"pellet_low",
	"pellet_refilled",
	"schedule_changed",
	"prediction_applied",
] as const;

const DEVICE_EVENT_TITLES: Record<string, string> = {
	connected: "Device reconnected",
	disconnected: "Device offline",
	command_failed: "Device command failed",
	pellet_low: "Feed level low",
	pellet_refilled: "Hopper refilled",
	schedule_changed: "Schedule changed",
	prediction_applied: "AI recommendation applied",
};

function toStatus(status: string): CalendarEventStatus {
	if (status === "DONE") return "done";
	if (status === "MISSED") return "missed";
	if (status === "CANCELLED") return "cancelled";
	return "planned";
}

function parseTypes(raw: string | null): Set<CalendarEventType> {
	if (!raw) {
		return new Set(CALENDAR_EVENT_TYPES.filter((type) => type !== "feeding"));
	}
	const requested = raw
		.split(",")
		.map((value) => value.trim())
		.filter(isCalendarEventType);
	return requested.length > 0
		? new Set(requested)
		: new Set(CALENDAR_EVENT_TYPES.filter((type) => type !== "feeding"));
}

function formatMinutes(totalMinutes: number): string {
	const hours = Math.floor(totalMinutes / 60) % 24;
	const minutes = totalMinutes % 60;
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export const GET = withApi(
	withAuth(async (request, { ownerId }) => {
		const url = new URL(request.url);
		const today = todayDateOnly();
		const from = url.searchParams.get("from") ?? addDays(today, -14);
		const to = url.searchParams.get("to") ?? addDays(today, 45);

		if (!isValidDateOnly(from) || !isValidDateOnly(to)) {
			throw validationFailed("`from` and `to` must be valid YYYY-MM-DD dates.");
		}
		const span = daysBetween(from, to);
		if (span < 1 || span > MAX_RANGE_DAYS) {
			throw validationFailed(`Choose a date range between 1 and ${MAX_RANGE_DAYS} days.`);
		}

		const pondFilter = url.searchParams.get("pondId");
		const types = parseTypes(url.searchParams.get("types"));
		// `scope=org` is used by the admin calendar. resolveOrgScope fails closed
		// for non-admins (empty scope), so this cannot widen a normal user's view.
		const orgScope = url.searchParams.get("scope") === "org" ? await resolveOrgScope() : null;
		if (orgScope && orgScope.pondIds.length === 0) {
			throw notFound("No active ponds in your organization.");
		}

		const ponds = await prisma.pond.findMany({
			where: orgScope
				? { id: { in: orgScope.pondIds }, status: "ACTIVE" }
				: { ownerId, status: "ACTIVE" },
			select: {
				id: true,
				name: true,
				sampleIntervalDays: true,
				createdAt: true,
				isFallow: true,
			},
			orderBy: { createdAt: "asc" },
			take: 100,
		});
		if (ponds.length === 0) throw notFound("No active pond.");

		const selectedPonds =
			!pondFilter || pondFilter === "active"
				? [ponds[0]]
				: pondFilter === "all"
					? ponds
					: ponds.filter((pond) => pond.id === pondFilter);
		if (selectedPonds.length === 0) throw notFound("Pond not found.");
		const pondIds = selectedPonds.map((pond) => pond.id);
		const pondById = new Map(selectedPonds.map((pond) => [pond.id, pond]));
		const range = dateRangeUtc(from, to);
		const events: CalendarEventDto[] = [];
		let truncated = false;

		// Persisted cycle/manual events.
		if (types.has("harvest") || types.has("manual")) {
			const persisted = await prisma.pondEvent.findMany({
				where: {
					pondId: { in: pondIds },
					startsAt: { gte: range.gte, lt: range.lte },
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
				events.push({
					id: `pond:${event.id}`,
					title: event.title,
					start: dateOnlyEventStart(event.startsAt),
					allDay: true,
					type,
					status: toStatus(event.status),
					kind: event.type,
					editable:
						event.source === "manual" ||
						(event.type === "HARVEST_PLANNED" && event.status === "PLANNED"),
					pondId: event.pond.id,
					pondName: event.pond.name,
					cycleLabel: event.cropCycle?.label ?? null,
					notes: event.notes,
					href: "/dashboard/harvest",
				});
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

			for (const pond of selectedPonds) {
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
		if (types.has("feeding") && span <= MAX_FEEDING_RANGE_DAYS) {
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
				selectedPonds.map(async (pond) => {
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
					eventType: { in: [...DEVICE_EVENT_TYPES] },
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
					pondId: pond.id,
					pondName: pond.name,
					notes: event.device.label,
				});
			}
		}

		events.sort((a, b) => a.start.localeCompare(b.start));
		if (events.length > MAX_EVENTS) {
			events.length = MAX_EVENTS;
			truncated = true;
		}

		return ok({ events, truncated, from, to }, { headers: { "Cache-Control": "no-store" } });
	}),
	{ route: "GET /api/calendar/events", timeoutMs: 8_000, slowMs: 3_000, violationMs: 8_000 },
);
