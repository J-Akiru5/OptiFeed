import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import {
	type PlatformIncidentEventType,
	type PlatformIncidentSeverity,
	type PlatformIncidentSource,
	type PlatformIncidentStatus,
	type SortableTrackedIncident,
	type TrackedIncidentSummary,
	isAckOverdue,
	platformIncidentAgeMs,
	sortTrackedIncidents,
	summarizeTrackedIncidents,
} from "@/lib/platform/incident-lifecycle-rules";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Persisted incident read model (issue #479, M3C.6).
 *
 * The queue page already has a derived read model (`incidents.ts`). This module
 * adds the stored rows: what the device watch opened, who owns it, how old it
 * is, and whether an escalation's 30-minute acknowledgement target has passed.
 * It writes nothing; both the manual actions and the sync live elsewhere.
 *
 * A failed incident read is `available: false`, never an empty, healthy-looking
 * board. Missing enrichment (an org, pond, device or owner that was deleted) is
 * `null` and is rendered as `Not reported`; it does not hide the incident.
 */

export const TRACKED_INCIDENT_LIMIT = 200;
export const TRACKED_RESOLVED_LIMIT = 20;
export const INCIDENT_EVENT_LIMIT = 200;
const RESOLVED_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface PlatformIncidentOwner {
	id: string;
	label: string;
}

export interface PlatformIncidentOwnerList {
	available: boolean;
	owners: PlatformIncidentOwner[];
}

export interface TrackedIncidentRow extends SortableTrackedIncident {
	dedupeKey: string;
	source: PlatformIncidentSource;
	title: string;
	summary: string | null;
	orgName: string | null;
	pondName: string | null;
	deviceLabel: string | null;
	ownerId: string | null;
	ownerName: string | null;
	acknowledgedAt: Date | null;
	escalatedAt: Date | null;
	lastSeenAt: Date;
	ageMs: number;
	ackOverdue: boolean;
	/** Fault code from metadata, when the source is FAULT. */
	fault: string | null;
	/** Background-job type from metadata, when the source is FAILED_JOB. */
	jobType: string | null;
	metadata: unknown;
}

export interface TrackedIncidentBoard {
	available: boolean;
	rows: TrackedIncidentRow[];
	summary: TrackedIncidentSummary;
	/** Open rows in the database, which can exceed the rows rendered. */
	totalOpen: number;
	truncated: boolean;
}

export interface TrackedIncidentEventRow {
	id: string;
	type: PlatformIncidentEventType;
	fromStatus: PlatformIncidentStatus | null;
	toStatus: PlatformIncidentStatus | null;
	actorId: string | null;
	actorName: string | null;
	note: string | null;
	metadata: unknown;
	createdAt: Date;
}

export interface TrackedIncidentDetail {
	incident: TrackedIncidentRow;
	events: TrackedIncidentEventRow[];
	eventsAvailable: boolean;
	owners: PlatformIncidentOwner[];
	ownersAvailable: boolean;
}

const EMPTY_SUMMARY: TrackedIncidentSummary = {
	open: 0,
	escalated: 0,
	overdue: 0,
	resolved: 0,
	counts: { CRITICAL: 0, WARNING: 0, INFO: 0 },
};

/** The board a failed read returns: explicitly unavailable, never "all clear". */
export function emptyTrackedIncidentBoard(): TrackedIncidentBoard {
	return {
		available: false,
		rows: [],
		summary: EMPTY_SUMMARY,
		totalOpen: 0,
		truncated: false,
	};
}

function recordOf(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

async function userLabels(ids: readonly string[]): Promise<Map<string, string>> {
	const unique = [...new Set(ids)];
	if (unique.length === 0) return new Map();
	try {
		const users = await prisma.user.findMany({
			where: { id: { in: unique } },
			take: unique.length,
			select: { id: true, displayName: true, email: true },
		});
		return new Map(users.map((user) => [user.id, user.displayName || user.email]));
	} catch {
		// Names are enrichment. A failed read leaves the id visible in the row's
		// owner column; it never hides the incident itself.
		return new Map();
	}
}

interface IncidentRowSelect {
	id: string;
	dedupeKey: string;
	source: PlatformIncidentSource;
	severity: PlatformIncidentSeverity;
	status: PlatformIncidentStatus;
	title: string;
	summary: string | null;
	orgId: string | null;
	pondId: string | null;
	deviceId: string | null;
	ownerId: string | null;
	openedAt: Date;
	acknowledgedAt: Date | null;
	resolvedAt: Date | null;
	escalatedAt: Date | null;
	ackDueAt: Date | null;
	lastSeenAt: Date;
	metadata: Prisma.JsonValue | null;
}

const INCIDENT_SELECT = {
	id: true,
	dedupeKey: true,
	source: true,
	severity: true,
	status: true,
	title: true,
	summary: true,
	orgId: true,
	pondId: true,
	deviceId: true,
	ownerId: true,
	openedAt: true,
	acknowledgedAt: true,
	resolvedAt: true,
	escalatedAt: true,
	ackDueAt: true,
	lastSeenAt: true,
	metadata: true,
} satisfies Prisma.PlatformIncidentSelect;

async function resolveNames(rows: readonly IncidentRowSelect[]) {
	const orgIds = [...new Set(rows.flatMap((row) => (row.orgId ? [row.orgId] : [])))];
	const pondIds = [...new Set(rows.flatMap((row) => (row.pondId ? [row.pondId] : [])))];
	const deviceIds = [...new Set(rows.flatMap((row) => (row.deviceId ? [row.deviceId] : [])))];
	const ownerIds = [...new Set(rows.flatMap((row) => (row.ownerId ? [row.ownerId] : [])))];

	const [orgs, ponds, devices, owners] = await Promise.all([
		orgIds.length > 0
			? prisma.organization
					.findMany({
						where: { id: { in: orgIds } },
						take: orgIds.length,
						select: { id: true, name: true },
					})
					.catch(() => [])
			: [],
		pondIds.length > 0
			? prisma.pond
					.findMany({
						where: { id: { in: pondIds } },
						take: pondIds.length,
						select: { id: true, name: true },
					})
					.catch(() => [])
			: [],
		deviceIds.length > 0
			? prisma.energyDevice
					.findMany({
						where: { id: { in: deviceIds } },
						take: deviceIds.length,
						select: { id: true, label: true },
					})
					.catch(() => [])
			: [],
		await userLabels(ownerIds),
	]);

	return {
		orgById: new Map(orgs.map((org) => [org.id, org.name])),
		pondById: new Map(ponds.map((pond) => [pond.id, pond.name])),
		deviceById: new Map(devices.map((device) => [device.id, device.label])),
		ownerById: owners,
	};
}

function mapRow(
	row: IncidentRowSelect,
	names: Awaited<ReturnType<typeof resolveNames>>,
	now: Date,
): TrackedIncidentRow {
	const metadata = recordOf(row.metadata);
	return {
		id: row.id,
		dedupeKey: row.dedupeKey,
		source: row.source,
		severity: row.severity,
		status: row.status,
		title: row.title,
		summary: row.summary,
		orgName: row.orgId ? (names.orgById.get(row.orgId) ?? null) : null,
		pondName: row.pondId ? (names.pondById.get(row.pondId) ?? null) : null,
		deviceLabel: row.deviceId ? (names.deviceById.get(row.deviceId) ?? null) : null,
		ownerId: row.ownerId,
		ownerName: row.ownerId ? (names.ownerById.get(row.ownerId) ?? null) : null,
		openedAt: row.openedAt,
		acknowledgedAt: row.acknowledgedAt,
		resolvedAt: row.resolvedAt,
		escalatedAt: row.escalatedAt,
		ackDueAt: row.ackDueAt,
		lastSeenAt: row.lastSeenAt,
		ageMs: platformIncidentAgeMs(row.openedAt, now),
		ackOverdue: isAckOverdue(row, now),
		fault: typeof metadata.fault === "string" ? metadata.fault : null,
		jobType: typeof metadata.jobType === "string" ? metadata.jobType : null,
		metadata: row.metadata,
	};
}

/**
 * Read the tracked board. Callers must already have passed the platform-admin
 * gate (`getIncidentQueue` does). Never throws: a failed read is unavailable.
 */
export async function loadTrackedIncidents(now: Date = new Date()): Promise<TrackedIncidentBoard> {
	try {
		const resolvedSince = new Date(now.getTime() - RESOLVED_LOOKBACK_MS);
		const [openRows, resolvedRows, totalOpen] = await Promise.all([
			prisma.platformIncident.findMany({
				where: { status: { not: "RESOLVED" } },
				orderBy: { openedAt: "asc" },
				take: TRACKED_INCIDENT_LIMIT + 1,
				select: INCIDENT_SELECT,
			}),
			prisma.platformIncident.findMany({
				where: { status: "RESOLVED", resolvedAt: { gte: resolvedSince } },
				orderBy: { resolvedAt: "desc" },
				take: TRACKED_RESOLVED_LIMIT,
				select: INCIDENT_SELECT,
			}),
			prisma.platformIncident.count({ where: { status: { not: "RESOLVED" } } }),
		]);

		const truncated = openRows.length > TRACKED_INCIDENT_LIMIT;
		const rows = [...openRows.slice(0, TRACKED_INCIDENT_LIMIT), ...resolvedRows];
		const names = await resolveNames(rows);
		const mapped = sortTrackedIncidents(
			rows.map((row) => mapRow(row, names, now)),
			now,
		);
		const summary = summarizeTrackedIncidents(mapped, now);

		return {
			available: true,
			rows: mapped,
			summary: { ...summary, open: totalOpen },
			totalOpen,
			truncated,
		};
	} catch {
		return emptyTrackedIncidentBoard();
	}
}

async function loadOwners(now: Date): Promise<PlatformIncidentOwnerList> {
	try {
		const grants = await prisma.platformAdmin.findMany({
			where: {
				revokedAt: null,
				OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
			},
			take: 100,
			select: { userId: true },
		});
		if (grants.length === 0) return { available: true, owners: [] };

		const users = await prisma.user.findMany({
			where: { id: { in: grants.map((grant) => grant.userId) } },
			take: grants.length,
			select: { id: true, displayName: true, email: true },
		});
		const byId = new Map(users.map((user) => [user.id, user]));
		const owners: PlatformIncidentOwner[] = [];
		for (const grant of grants) {
			const user = byId.get(grant.userId);
			if (!user) continue;
			owners.push({ id: user.id, label: user.displayName || user.email });
		}
		owners.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
		return { available: true, owners };
	} catch {
		return { available: false, owners: [] };
	}
}

/** Active platform admins who can own an escalated incident. */
export async function listPlatformIncidentOwners(
	now: Date = new Date(),
): Promise<PlatformIncidentOwnerList> {
	await requirePlatformAdmin();
	return loadOwners(now);
}

/**
 * One incident with its timeline and the owners the escalation picker offers.
 * `null` means the id does not exist; a failed timeline read is flagged rather
 * than rendered as an incident with no history.
 */
export async function getPlatformIncidentDetail(
	incidentId: string,
	now: Date = new Date(),
): Promise<TrackedIncidentDetail | null> {
	await requirePlatformAdmin();

	const row = await prisma.platformIncident.findUnique({
		where: { id: incidentId },
		select: INCIDENT_SELECT,
	});
	if (!row) return null;

	const [names, eventsAttempt, ownerList] = await Promise.all([
		resolveNames([row]),
		(async () => {
			try {
				const events = await prisma.platformIncidentEvent.findMany({
					where: { incidentId },
					orderBy: { createdAt: "asc" },
					take: INCIDENT_EVENT_LIMIT,
					select: {
						id: true,
						type: true,
						fromStatus: true,
						toStatus: true,
						actorId: true,
						note: true,
						metadata: true,
						createdAt: true,
					},
				});
				return { ok: true as const, events };
			} catch {
				return { ok: false as const, events: [] };
			}
		})(),
		loadOwners(now),
	]);

	const actorIds = [
		...new Set(eventsAttempt.events.flatMap((event) => (event.actorId ? [event.actorId] : []))),
	];
	const actorNames = await userLabels(actorIds);
	const events: TrackedIncidentEventRow[] = eventsAttempt.events.map((event) => ({
		id: event.id,
		type: event.type,
		fromStatus: event.fromStatus,
		toStatus: event.toStatus,
		actorId: event.actorId,
		actorName: event.actorId ? (actorNames.get(event.actorId) ?? event.actorId) : null,
		note: event.note,
		metadata: event.metadata,
		createdAt: event.createdAt,
	}));

	return {
		incident: mapRow(row, names, now),
		events,
		eventsAvailable: eventsAttempt.ok,
		owners: ownerList.owners,
		ownersAvailable: ownerList.available,
	};
}
