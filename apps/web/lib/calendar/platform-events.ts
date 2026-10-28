import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import {
	MAX_CALENDAR_EVENTS,
	MAX_CALENDAR_RANGE_DAYS,
	PLATFORM_DEVICE_EVENT_TYPES,
	loadCalendarEventSources,
	parseCalendarEventTypes,
} from "@/lib/calendar/event-sources";
import type { CalendarEventDto, CalendarEventType } from "@/lib/crop-cycle/calendar";
import { addDays, daysBetween, isValidDateOnly, todayDateOnly } from "@/lib/crop-cycle/dates";
import prisma from "@/lib/prisma";

/**
 * Platform calendar across every tenant (E16.2, issue #2026-10-27).
 *
 * Read-only: the superadmin can see pond events, tasks, cycle milestones,
 * sample-due reminders and device incidents for every organization, filter
 * them, open the detail and jump to the org/pond page. Nothing here edits
 * tenant data — writes stay behind the view-as rules.
 *
 * Event shaping is the farmer calendar's own loader (`event-sources.ts`), so
 * recurrence expansion, colours and caps are identical on both paths.
 */

export interface PlatformCalendarFilters {
	/** Inclusive `YYYY-MM-DD` bounds. */
	from: string;
	to: string;
	orgIds: string[];
	/** A pond id, or `all`. */
	pondId: string;
	types: CalendarEventType[];
}

export interface PlatformCalendarOrgOption {
	id: string;
	name: string;
}

export interface PlatformCalendarPondOption {
	id: string;
	name: string;
	orgIds: string[];
	orgNames: string[];
}

export interface PlatformCalendarEvent extends CalendarEventDto {
	orgIds: string[];
	orgNames: string[];
	createdByName: string | null;
}

export interface PlatformCalendarData {
	events: PlatformCalendarEvent[];
	truncated: boolean;
	from: string;
	to: string;
	filters: PlatformCalendarFilters;
	orgs: PlatformCalendarOrgOption[];
	ponds: PlatformCalendarPondOption[];
}

const MAX_PONDS = 500;

function first(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

/**
 * Read the calendar filters from a URL search object. Invalid dates fall back
 * to the farmer calendar's default window, and an over-long range is clamped,
 * so a shared or hand-edited link still renders a usable page.
 */
export function parsePlatformCalendarQuery(
	params: Record<string, string | string[] | undefined>,
	today: string = todayDateOnly(),
): PlatformCalendarFilters {
	let from = first(params.from) ?? addDays(today, -14);
	let to = first(params.to) ?? addDays(today, 45);

	if (!isValidDateOnly(from) || !isValidDateOnly(to)) {
		from = addDays(today, -14);
		to = addDays(today, 45);
	}
	// Inclusive day count: a one-day platform range (from === to) is valid
	// and must not be replaced by the 60-day default (#276).
	const span = daysBetween(from, to) + 1;
	if (span < 1) {
		from = addDays(today, -14);
		to = addDays(today, 45);
	} else if (span > MAX_CALENDAR_RANGE_DAYS) {
		to = addDays(from, MAX_CALENDAR_RANGE_DAYS - 1);
	}

	const orgIds = [
		...new Set(
			(first(params.orgs) ?? "")
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean),
		),
	].slice(0, 50);
	const pondId = first(params.pond)?.trim() || "all";

	return {
		from,
		to,
		orgIds,
		pondId,
		types: [...parseCalendarEventTypes(first(params.types))],
	};
}

interface PlatformPondRow {
	id: string;
	name: string;
	sampleIntervalDays: number;
	createdAt: Date;
	isFallow: boolean;
	ownerId: string;
	owner: { id: string; displayName: string | null } | null;
}

/** All active ponds with the organizations their owner belongs to. */
async function loadPondScope(): Promise<{
	ponds: PlatformPondRow[];
	orgs: PlatformCalendarOrgOption[];
	orgIdsByPond: Map<string, string[]>;
	orgNamesByPond: Map<string, string[]>;
}> {
	const orgs = await prisma.organization.findMany({
		select: { id: true, name: true },
		orderBy: { name: "asc" },
	});
	const orgNameById = new Map(orgs.map((org) => [org.id, org.name]));

	const ponds = (await prisma.pond.findMany({
		where: { status: "ACTIVE" },
		select: {
			id: true,
			name: true,
			sampleIntervalDays: true,
			createdAt: true,
			isFallow: true,
			ownerId: true,
			owner: { select: { id: true, displayName: true } },
		},
		orderBy: { name: "asc" },
		take: MAX_PONDS,
	})) as PlatformPondRow[];

	const ownerUserIds = [
		...new Set(ponds.map((pond) => pond.owner?.id).filter((id): id is string => Boolean(id))),
	];
	const memberships = ownerUserIds.length
		? await prisma.membership.findMany({
				where: { userId: { in: ownerUserIds }, revokedAt: null },
				select: { userId: true, orgId: true },
			})
		: [];
	const orgIdsByOwner = new Map<string, string[]>();
	for (const membership of memberships) {
		const list = orgIdsByOwner.get(membership.userId) ?? [];
		if (!list.includes(membership.orgId)) list.push(membership.orgId);
		orgIdsByOwner.set(membership.userId, list);
	}

	const orgIdsByPond = new Map<string, string[]>();
	const orgNamesByPond = new Map<string, string[]>();
	for (const pond of ponds) {
		const orgIds = pond.owner ? (orgIdsByOwner.get(pond.owner.id) ?? []) : [];
		orgIdsByPond.set(pond.id, orgIds);
		orgNamesByPond.set(
			pond.id,
			orgIds.map((orgId) => orgNameById.get(orgId)).filter((name): name is string => Boolean(name)),
		);
	}

	return { ponds, orgs, orgIdsByPond, orgNamesByPond };
}

/**
 * The OTA window is a fixed daily maintenance band (10:00–15:00) shown on the
 * platform calendar; it needs no stored data and never edits anything.
 */
function otaWindowEvents(from: string, to: string): PlatformCalendarEvent[] {
	const events: PlatformCalendarEvent[] = [];
	const span = daysBetween(from, to);
	for (let offset = 0; offset <= span; offset += 1) {
		const day = addDays(from, offset);
		events.push({
			id: `ota:${day}`,
			title: "OTA window",
			start: `${day}T10:00:00`,
			end: `${day}T15:00:00`,
			allDay: false,
			type: "device",
			kind: "OTA_WINDOW",
			status: "planned",
			display: "background",
			editable: false,
			pondId: "platform",
			pondName: "",
			orgIds: [],
			orgNames: [],
			createdByName: null,
		});
	}
	return events;
}

/**
 * Load the platform calendar. The caller gates the request (page or API).
 * Every database read is a set query over the visible scope; there is no
 * per-pond or per-org loop that issues a query.
 */
export async function loadPlatformCalendarData(
	filters: PlatformCalendarFilters,
): Promise<PlatformCalendarData> {
	const { ponds, orgs, orgIdsByPond, orgNamesByPond } = await loadPondScope();
	const pondOptions: PlatformCalendarPondOption[] = ponds.map((pond) => ({
		id: pond.id,
		name: pond.name,
		orgIds: orgIdsByPond.get(pond.id) ?? [],
		orgNames: orgNamesByPond.get(pond.id) ?? [],
	}));

	const selectedOrgIds = new Set(filters.orgIds);
	let scopedPonds = ponds;
	if (selectedOrgIds.size > 0) {
		// A pond belongs to an organization when its owner is a live member.
		scopedPonds = ponds.filter((pond) =>
			(orgIdsByPond.get(pond.id) ?? []).some((orgId) => selectedOrgIds.has(orgId)),
		);
	}
	if (filters.pondId !== "all") {
		scopedPonds = scopedPonds.filter((pond) => pond.id === filters.pondId);
	}

	const { events, truncated } = await loadCalendarEventSources({
		ponds: scopedPonds,
		from: filters.from,
		to: filters.to,
		today: todayDateOnly(),
		types: new Set(filters.types),
		// Feeding bands would need a schedule lookup per pond; the platform
		// view deliberately shows the tenant's stored work instead.
		includeFeeding: false,
		deviceEventTypes: PLATFORM_DEVICE_EVENT_TYPES,
		includeCreatorIds: true,
	});

	const creatorIds = [
		...new Set(
			events
				.map((event) => event.createdByUserId)
				.filter((id): id is string => typeof id === "string" && id.length > 0),
		),
	];
	const creators = creatorIds.length
		? await prisma.user.findMany({
				where: { id: { in: creatorIds } },
				select: { id: true, displayName: true },
			})
		: [];
	const creatorNameById = new Map(creators.map((user) => [user.id, user.displayName]));

	const pondById = new Map(scopedPonds.map((pond) => [pond.id, pond]));
	const withOrg: PlatformCalendarEvent[] = events.map((event) => ({
		...event,
		orgIds: pondById.has(event.pondId) ? (orgIdsByPond.get(event.pondId) ?? []) : [],
		orgNames: pondById.has(event.pondId) ? (orgNamesByPond.get(event.pondId) ?? []) : [],
		createdByName: event.createdByUserId
			? (creatorNameById.get(event.createdByUserId) ?? null)
			: null,
	}));

	withOrg.push(...otaWindowEvents(filters.from, filters.to));
	withOrg.sort((a, b) => a.start.localeCompare(b.start));

	let wasTruncated = truncated;
	if (withOrg.length > MAX_CALENDAR_EVENTS) {
		withOrg.length = MAX_CALENDAR_EVENTS;
		wasTruncated = true;
	}

	return {
		events: withOrg,
		truncated: wasTruncated,
		from: filters.from,
		to: filters.to,
		filters,
		orgs,
		ponds: pondOptions,
	};
}

/** Page entry point: gate first, then load. */
export async function listPlatformCalendarEvents(
	params: Record<string, string | string[] | undefined>,
): Promise<PlatformCalendarData> {
	await requirePlatformAdmin();
	return loadPlatformCalendarData(parsePlatformCalendarQuery(params));
}
