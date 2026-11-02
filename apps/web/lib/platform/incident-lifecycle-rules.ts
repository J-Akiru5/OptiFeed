/**
 * Platform incident lifecycle rules (issue #479, M3C.6; plan decisions O19/O20).
 *
 * `incident-rules.ts` answers "what is open, how bad, how long" by deriving a
 * queue on read. This file adds the *stored* side: the states an incident can
 * move through, who may move it, the stable key that stops a repeating
 * condition from opening a second incident, and the 30-minute acknowledgement
 * target an escalation sets.
 *
 * Pure data and pure functions only: no Prisma, no auth, no React. The action
 * in `lib/actions/platform/incidents.ts` and the device-watch sync in
 * `lib/platform/incident-sync.ts` both validate through these functions, so the
 * UI, the operator action and the system transition cannot disagree about what
 * is legal.
 *
 * Two deliberate limits:
 *  - `RESOLVED` is terminal for operator actions. There is no reopen button.
 *    The sync reopens the same row when the condition is observed again, which
 *    is a system transition and is recorded as `AUTO_OPENED` with a note.
 *  - The source is auto-managed only for the four conditions the device watch
 *    can observe (`device_offline`, `safe_mode`, `fault`, `failed_job`).
 *    `notification` and `manual` incidents wait for a human.
 */

export const PLATFORM_INCIDENT_STATUSES = [
	"NEW",
	"ACKNOWLEDGED",
	"INVESTIGATING",
	"RESOLVED",
	"ESCALATED",
] as const;

export type PlatformIncidentStatus = (typeof PLATFORM_INCIDENT_STATUSES)[number];

export const PLATFORM_INCIDENT_SEVERITIES = ["CRITICAL", "WARNING", "INFO"] as const;

export type PlatformIncidentSeverity = (typeof PLATFORM_INCIDENT_SEVERITIES)[number];

export const PLATFORM_INCIDENT_SOURCES = [
	"DEVICE_OFFLINE",
	"SAFE_MODE",
	"FAULT",
	"FAILED_JOB",
	"NOTIFICATION",
	"MANUAL",
] as const;

export type PlatformIncidentSource = (typeof PLATFORM_INCIDENT_SOURCES)[number];

export const PLATFORM_INCIDENT_EVENT_TYPES = [
	"AUTO_OPENED",
	"AUTO_RESOLVED",
	"ACKNOWLEDGED",
	"INVESTIGATING",
	"RESOLVED",
	"ESCALATED",
	"NOTIFIED",
] as const;

export type PlatformIncidentEventType = (typeof PLATFORM_INCIDENT_EVENT_TYPES)[number];

/** The operator actions the detail page can offer. */
export const PLATFORM_INCIDENT_ACTIONS = [
	"acknowledge",
	"investigate",
	"resolve",
	"escalate",
] as const;

export type PlatformIncidentAction = (typeof PLATFORM_INCIDENT_ACTIONS)[number];

/** Rank, not a score: 0 is worst. Shared with the derived queue's ordering. */
export const PLATFORM_INCIDENT_SEVERITY_ORDER: Record<PlatformIncidentSeverity, number> = {
	CRITICAL: 0,
	WARNING: 1,
	INFO: 2,
};

/** O20: an escalated incident has thirty minutes to be acknowledged. */
export const INCIDENT_ACK_TARGET_MS = 30 * 60 * 1000;

/**
 * Actor id used on a `PlatformAuditLog` row for a system transition. It is not
 * a user account; the timeline event keeps `actorId` null so the platform audit
 * explorer can still show that no human performed the transition.
 */
export const SYSTEM_ACTOR_ID = "system";

/**
 * Legal operator transitions. There is no edge out of `RESOLVED`; the sync
 * writes the reopen, not an operator.
 */
export const PLATFORM_INCIDENT_TRANSITIONS: Record<
	PlatformIncidentStatus,
	readonly PlatformIncidentStatus[]
> = {
	NEW: ["ACKNOWLEDGED", "INVESTIGATING", "ESCALATED"],
	ACKNOWLEDGED: ["INVESTIGATING", "RESOLVED", "ESCALATED"],
	INVESTIGATING: ["RESOLVED", "ESCALATED"],
	// An escalated incident can be picked up (acknowledged), investigated, or
	// resolved directly. Resolving one is explicitly allowed.
	ESCALATED: ["ACKNOWLEDGED", "INVESTIGATING", "RESOLVED"],
	RESOLVED: [],
};

/** True when an operator may move an incident from `from` to `to`. */
export function isLegalTransition(
	from: PlatformIncidentStatus,
	to: PlatformIncidentStatus,
): boolean {
	return PLATFORM_INCIDENT_TRANSITIONS[from].includes(to);
}

/** The target status of an operator action from `from`, or null when illegal. */
export function targetStatusForAction(
	action: PlatformIncidentAction,
	from: PlatformIncidentStatus,
): PlatformIncidentStatus | null {
	const to: PlatformIncidentStatus =
		action === "acknowledge"
			? "ACKNOWLEDGED"
			: action === "investigate"
				? "INVESTIGATING"
				: action === "resolve"
					? "RESOLVED"
					: "ESCALATED";
	return isLegalTransition(from, to) ? to : null;
}

/** The event type written for an operator action. */
export function eventTypeForAction(action: PlatformIncidentAction): PlatformIncidentEventType {
	if (action === "acknowledge") return "ACKNOWLEDGED";
	if (action === "investigate") return "INVESTIGATING";
	if (action === "resolve") return "RESOLVED";
	return "ESCALATED";
}

/** Open means anything but resolved; resolved rows stay in history. */
export function isOpenIncidentStatus(status: PlatformIncidentStatus): boolean {
	return status !== "RESOLVED";
}

/** Sources the device-watch sync owns. A `notification` or `manual` incident is never auto-resolved. */
export function isAutoManagedSource(source: PlatformIncidentSource): boolean {
	return (
		source === "DEVICE_OFFLINE" ||
		source === "SAFE_MODE" ||
		source === "FAULT" ||
		source === "FAILED_JOB"
	);
}

// ---------------------------------------------------------------------------
// Stable dedupe keys.
// ---------------------------------------------------------------------------

export function deviceOfflineIncidentKey(deviceId: string): string {
	return `device_offline:${deviceId}`;
}

export function safeModeIncidentKey(deviceId: string): string {
	return `safe_mode:${deviceId}`;
}

export function faultIncidentKey(deviceId: string, fault: string): string {
	return `fault:${deviceId}:${fault}`;
}

export function failedJobIncidentKey(jobId: string): string {
	return `failed_job:${jobId}`;
}

/** Reserved for a future notification ingestion path. */
export function notificationIncidentKey(pondId: string | null, category: string | null): string {
	return `notification:${pondId ?? "__unassigned__"}:${category ?? "general"}`;
}

// ---------------------------------------------------------------------------
// Acknowledgement target (O20).
// ---------------------------------------------------------------------------

export function escalationAckDueAt(now: Date): Date {
	return new Date(now.getTime() + INCIDENT_ACK_TARGET_MS);
}

export interface AckTarget {
	status: PlatformIncidentStatus;
	ackDueAt: Date | null;
}

/**
 * An escalated incident whose 30-minute target has passed. Acknowledging moves
 * the status to `ACKNOWLEDGED`, so the same row stops being overdue; the row
 * keeps `ackDueAt` for the record.
 */
export function isAckOverdue(incident: AckTarget, now: Date): boolean {
	return (
		incident.status === "ESCALATED" &&
		incident.ackDueAt !== null &&
		incident.ackDueAt.getTime() < now.getTime()
	);
}

/** How long the incident has been open; never negative when clocks disagree. */
export function platformIncidentAgeMs(openedAt: Date, now: Date): number {
	return Math.max(0, now.getTime() - openedAt.getTime());
}

// ---------------------------------------------------------------------------
// Ordering and summary for the queue and board.
// ---------------------------------------------------------------------------

export interface SortableTrackedIncident {
	id: string;
	status: PlatformIncidentStatus;
	severity: PlatformIncidentSeverity;
	openedAt: Date;
	ackDueAt: Date | null;
	resolvedAt: Date | null;
}

/**
 * An escalated incident with a missed acknowledgement is the most urgent thing
 * on the page, then any other escalated incident, then open work worst/oldest
 * first, then recently resolved rows. The operator reads from the top.
 */
export function sortTrackedIncidents<T extends SortableTrackedIncident>(
	incidents: readonly T[],
	now: Date,
): T[] {
	const rank = (incident: T): number => {
		if (isAckOverdue(incident, now)) return 0;
		if (incident.status === "ESCALATED") return 1;
		if (isOpenIncidentStatus(incident.status)) return 2;
		return 3;
	};

	return [...incidents].sort((a, b) => {
		const band = rank(a) - rank(b);
		if (band !== 0) return band;

		if (a.status === "RESOLVED" && b.status === "RESOLVED") {
			return (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0);
		}

		const severity =
			PLATFORM_INCIDENT_SEVERITY_ORDER[a.severity] - PLATFORM_INCIDENT_SEVERITY_ORDER[b.severity];
		if (severity !== 0) return severity;
		return a.openedAt.getTime() - b.openedAt.getTime();
	});
}

export interface TrackedIncidentSummary {
	open: number;
	escalated: number;
	overdue: number;
	resolved: number;
	counts: Record<PlatformIncidentSeverity, number>;
}

/** Summary over the rows the loader could read. Open counts exclude resolved rows. */
export function summarizeTrackedIncidents(
	incidents: readonly SortableTrackedIncident[],
	now: Date,
): TrackedIncidentSummary {
	const counts: Record<PlatformIncidentSeverity, number> = { CRITICAL: 0, WARNING: 0, INFO: 0 };
	let open = 0;
	let escalated = 0;
	let overdue = 0;
	let resolved = 0;

	for (const incident of incidents) {
		if (incident.status === "RESOLVED") {
			resolved += 1;
			continue;
		}
		open += 1;
		counts[incident.severity] += 1;
		if (incident.status === "ESCALATED") {
			escalated += 1;
			if (isAckOverdue(incident, now)) overdue += 1;
		}
	}

	return { open, escalated, overdue, resolved, counts };
}

// ---------------------------------------------------------------------------
// Sync planner: conditions in, upsert/resolve operations out.
// ---------------------------------------------------------------------------

/** One condition the device watch observed in this run. */
export interface ObservedIncidentCondition {
	dedupeKey: string;
	source: PlatformIncidentSource;
	severity: PlatformIncidentSeverity;
	title: string;
	summary: string | null;
	orgId: string | null;
	farmId: string | null;
	deviceId: string | null;
	pondId: string | null;
	observedAt: Date;
	metadata: Record<string, unknown>;
}

/** The fields of an incident row the planner needs. */
export interface ExistingTrackedIncident {
	id: string;
	dedupeKey: string;
	source: PlatformIncidentSource;
	status: PlatformIncidentStatus;
	orgId: string | null;
}

export interface IncidentSyncPlan {
	/** Conditions with no incident row yet: insert and record AUTO_OPENED. */
	open: ObservedIncidentCondition[];
	/** Open incidents whose condition is still present: refresh lastSeenAt only. */
	refresh: { incidentId: string; condition: ObservedIncidentCondition }[];
	/** Resolved incidents whose condition returned: reopen the same row. */
	reopen: { incidentId: string; condition: ObservedIncidentCondition }[];
	/** Open auto-managed incidents whose condition is gone: resolve. */
	resolve: { incidentId: string; from: PlatformIncidentStatus; orgId: string | null }[];
}

/**
 * Decide the sync's writes without touching the database.
 *
 * `availableSources` is the honesty gate: when the device, health or job reader
 * failed, its source is absent and its open incidents are left alone instead of
 * being auto-resolved on missing evidence.
 */
export function planIncidentSync(input: {
	observed: readonly ObservedIncidentCondition[];
	existing: readonly ExistingTrackedIncident[];
	availableSources: ReadonlySet<PlatformIncidentSource>;
}): IncidentSyncPlan {
	const observedByKey = new Map<string, ObservedIncidentCondition>();
	for (const condition of input.observed) observedByKey.set(condition.dedupeKey, condition);

	const existingByKey = new Map<string, ExistingTrackedIncident>();
	for (const incident of input.existing) existingByKey.set(incident.dedupeKey, incident);

	const plan: IncidentSyncPlan = { open: [], refresh: [], reopen: [], resolve: [] };

	for (const [key, condition] of observedByKey) {
		const existing = existingByKey.get(key);
		if (!existing) {
			plan.open.push(condition);
			continue;
		}
		if (existing.status === "RESOLVED") {
			plan.reopen.push({ incidentId: existing.id, condition });
			continue;
		}
		plan.refresh.push({ incidentId: existing.id, condition });
	}

	for (const incident of input.existing) {
		if (!isOpenIncidentStatus(incident.status)) continue;
		if (!isAutoManagedSource(incident.source)) continue;
		if (!input.availableSources.has(incident.source)) continue;
		if (observedByKey.has(incident.dedupeKey)) continue;
		plan.resolve.push({ incidentId: incident.id, from: incident.status, orgId: incident.orgId });
	}

	return plan;
}
