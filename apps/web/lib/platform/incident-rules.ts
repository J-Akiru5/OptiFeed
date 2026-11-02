import { type DeviceStatusPolicy, evaluateDeviceStatus } from "@/lib/device-status";
import { type BandState, deviceFleetState, worstState } from "@/lib/platform/status-band-rules";

/**
 * Incident queue rules (issue #479, M3C.5; plan decision O19 — derive first).
 *
 * The command center already has the *symptoms* of an incident scattered over
 * four places: a per-pond `Notification`, an unresolved `ErrorEvent`, a failed
 * `BackgroundJob`, and a device that stopped sending heartbeats. None of them is
 * an incident — there is no shared severity, no age, and the same condition can
 * appear in more than one of them. This file is the read model that answers
 * "what is open, how bad, how long" **without a schema change**: every incident
 * here is derived on read from rows that already exist.
 *
 * Three rules keep the queue honest, and they are the status bands' rules:
 *
 *  1. **The same condition is one incident.** A connectivity notification and
 *     the silent units behind it share one key, so the operator sees one row
 *     with both sources instead of two rows that look like two problems.
 *  2. **Worst wins, and age is the oldest sighting.** Deduplicating keeps the
 *     worst severity and the earliest `since`, never an average.
 *  3. **A failed source is `unknown`, never quiet.** The summary is `unknown`
 *     when any source did not report, because an empty queue is
 *     indistinguishable from an unread queue. A real `degraded`/`critical`
 *     incident still outranks that, exactly as in `status-band-rules.ts`.
 *
 * Severity is derived from thresholds that already exist: a tenant's device
 * condition comes from `deviceFleetState` (the band rule), so this file invents
 * no percentage and no health score. Nothing here is stored or mutated.
 */

export type IncidentSource = "device" | "notification" | "error" | "job";

export type IncidentSeverity = "critical" | "warning" | "info";

/** Routes an incident can point at. Literals keep typed routes happy. */
export type IncidentHref = "/superadmin/devices" | "/superadmin/operations/errors" | null;

/** Stable source order for the "sources" column and for tie-breaking. */
export const INCIDENT_SOURCE_ORDER: readonly IncidentSource[] = [
	"device",
	"notification",
	"error",
	"job",
];

/** Rank, not a score: 0 is worst. */
export const INCIDENT_SEVERITY_ORDER: Record<IncidentSeverity, number> = {
	critical: 0,
	warning: 1,
	info: 2,
};

export interface IncidentDetail {
	offline: number;
	total: number;
}

export interface IncidentCandidate {
	source: IncidentSource;
	/** Two candidates with the same key are the same condition. */
	key: string;
	/** A human sentence when the source has one; null means the page composes it. */
	title: string | null;
	tenantName: string | null;
	pondName: string | null;
	severity: IncidentSeverity;
	/** When the condition was first seen; null when the source cannot say. */
	since: Date | null;
	/** How many rows collapsed into this condition. */
	count: number;
	href: IncidentHref;
	detail: IncidentDetail | null;
}

export interface Incident extends Omit<IncidentCandidate, "source"> {
	sources: IncidentSource[];
}

// ---------------------------------------------------------------------------
// Severity, derived from what the source already says.
// ---------------------------------------------------------------------------

/**
 * A band state as an incident severity. `unknown` becomes `info` on purpose: an
 * unmeasured fleet is a gap to close, not a fault to page someone about — and
 * the summary still refuses to call the queue `ok` while a source is missing.
 */
export function bandSeverity(state: BandState): IncidentSeverity | null {
	if (state === "critical") return "critical";
	if (state === "degraded") return "warning";
	if (state === "unknown") return "info";
	return null;
}

/** Notification tiers are written by the ingestion paths (`CRITICAL`, `WARNING`, ...). */
export function notificationSeverity(tier: string): IncidentSeverity {
	const value = tier.toUpperCase();
	if (value === "CRITICAL") return "critical";
	if (value === "WARNING") return "warning";
	return "info";
}

/**
 * `ErrorSeverity` has no critical member: an ERROR is the worst the register
 * can say, so it maps to `warning`. Calling it critical would outrank a silent
 * fleet, which is a stronger fact than one captured exception.
 */
export function errorEventSeverity(severity: string): IncidentSeverity {
	const value = severity.toUpperCase();
	if (value === "ERROR" || value === "WARNING") return "warning";
	return "info";
}

/** One failed job is a warning; the platform band already escalates by count. */
export const JOB_INCIDENT_SEVERITY: IncidentSeverity = "warning";

// ---------------------------------------------------------------------------
// Dedupe keys.
// ---------------------------------------------------------------------------

const UNASSIGNED = "__unassigned__";

/** Key shared by a silent fleet and the connectivity notification about it. */
export function deviceIncidentKey(pondId: string | null): string {
	return `device:${pondId ?? UNASSIGNED}`;
}

/**
 * A `connectivity` notification is the alert *about* the same condition the
 * silent units already report, so it joins the device key. Every other category
 * is its own condition per pond.
 */
export function notificationIncidentKey(pondId: string | null, category: string | null): string {
	if (category === "connectivity") return deviceIncidentKey(pondId);
	return `notification:${pondId ?? UNASSIGNED}:${category ?? "general"}`;
}

export function errorIncidentKey(id: string): string {
	return `error:${id}`;
}

export function jobIncidentKey(id: string): string {
	return `job:${id}`;
}

// ---------------------------------------------------------------------------
// Source builders: rows in, candidates out. No queries here.
// ---------------------------------------------------------------------------

export interface IncidentDeviceInput {
	id: string;
	label: string;
	pondId: string | null;
	pondName: string | null;
	tenantName: string | null;
	lastSeenAt: Date | null;
}

/**
 * One candidate per pond, not per device: the question is "which pond cannot
 * feed", and a pond of eight feeders is one condition. The state comes from
 * `deviceFleetState`, so the thresholds are the bands' (20 % offline degraded,
 * 50 % critical) and a pond that never reported is `info` ("unmeasured"), never
 * `ok` and never critical.
 *
 * `since` is the heartbeat of the **first** unit to go quiet, which is when the
 * pond started losing contact.
 */
export function buildDeviceIncidents(
	devices: readonly IncidentDeviceInput[],
	now: Date,
	policy: DeviceStatusPolicy,
): IncidentCandidate[] {
	const groups = new Map<string, IncidentDeviceInput[]>();
	for (const device of devices) {
		const key = device.pondId ?? UNASSIGNED;
		const bucket = groups.get(key);
		if (bucket) bucket.push(device);
		else groups.set(key, [device]);
	}

	const candidates: IncidentCandidate[] = [];
	for (const [pondKey, bucket] of groups) {
		let offline = 0;
		let reporting = 0;
		let since: Date | null = null;

		for (const device of bucket) {
			if (device.lastSeenAt) reporting += 1;
			if (!evaluateDeviceStatus({ lastSeenAt: device.lastSeenAt, now, policy }).isOffline) continue;
			offline += 1;
			if (device.lastSeenAt && (!since || device.lastSeenAt < since)) since = device.lastSeenAt;
		}

		const state = deviceFleetState({ offline, reporting, total: bucket.length });
		const severity = bandSeverity(state);
		if (!severity) continue;

		const first = bucket[0] as IncidentDeviceInput;
		candidates.push({
			source: "device",
			key: deviceIncidentKey(pondKey === UNASSIGNED ? null : pondKey),
			title: null,
			tenantName: first.tenantName,
			pondName: first.pondName,
			severity,
			since,
			count: bucket.length,
			href: "/superadmin/devices",
			detail: { offline, total: bucket.length },
		});
	}

	return candidates;
}

export interface IncidentNotificationInput {
	id: string;
	pondId: string | null;
	pondName: string | null;
	tenantName: string | null;
	tier: string;
	category: string | null;
	message: string;
	createdAt: Date;
}

/** Open (unacknowledged, not auto-cleared) pond notifications. */
export function buildNotificationIncidents(
	rows: readonly IncidentNotificationInput[],
): IncidentCandidate[] {
	return rows.map((row) => ({
		source: "notification" as const,
		key: notificationIncidentKey(row.pondId, row.category),
		title: row.message,
		tenantName: row.tenantName,
		pondName: row.pondName,
		severity: notificationSeverity(row.tier),
		since: row.createdAt,
		count: 1,
		href: null,
		detail: null,
	}));
}

export interface IncidentErrorInput {
	id: string;
	message: string;
	severity: string;
	firstSeenAt: Date;
	count: number;
}

/** Unresolved error-register rows; the register is already a dedupe bucket. */
export function buildErrorIncidents(rows: readonly IncidentErrorInput[]): IncidentCandidate[] {
	return rows.map((row) => ({
		source: "error" as const,
		key: errorIncidentKey(row.id),
		title: row.message,
		tenantName: null,
		pondName: null,
		severity: errorEventSeverity(row.severity),
		since: row.firstSeenAt,
		count: row.count,
		href: "/superadmin/operations/errors",
		detail: null,
	}));
}

export interface IncidentJobInput {
	id: string;
	type: string;
	error: string | null;
	createdAt: Date;
	finishedAt: Date | null;
}

/** Failed background jobs: one incident per failed run, aged from when it failed. */
export function buildJobIncidents(rows: readonly IncidentJobInput[]): IncidentCandidate[] {
	return rows.map((row) => ({
		source: "job" as const,
		key: jobIncidentKey(row.id),
		title: row.error ? `${row.type}: ${row.error}` : row.type,
		tenantName: null,
		pondName: null,
		severity: JOB_INCIDENT_SEVERITY,
		since: row.finishedAt ?? row.createdAt,
		count: 1,
		href: null,
		detail: null,
	}));
}

// ---------------------------------------------------------------------------
// Dedupe, sort, summary.
// ---------------------------------------------------------------------------

function mergeSources(left: readonly IncidentSource[], right: readonly IncidentSource[]) {
	const seen = new Set<IncidentSource>([...left, ...right]);
	return INCIDENT_SOURCE_ORDER.filter((source) => seen.has(source));
}

/**
 * Collapse candidates that describe one condition.
 *
 * Worst severity survives, `since` takes the earliest sighting, counts add up,
 * and a notification's own sentence wins because it is written by whatever
 * detected the problem (the fleet text is generic).
 */
export function dedupeIncidents(candidates: readonly IncidentCandidate[]): Incident[] {
	const byKey = new Map<string, Incident>();

	for (const candidate of candidates) {
		const existing = byKey.get(candidate.key);
		if (!existing) {
			byKey.set(candidate.key, { ...candidate, sources: [candidate.source] });
			continue;
		}

		if (INCIDENT_SEVERITY_ORDER[candidate.severity] < INCIDENT_SEVERITY_ORDER[existing.severity]) {
			existing.severity = candidate.severity;
		}
		if (candidate.since && (!existing.since || candidate.since < existing.since)) {
			existing.since = candidate.since;
		}
		existing.count += candidate.count;
		existing.sources = mergeSources(existing.sources, [candidate.source]);
		existing.detail = existing.detail ?? candidate.detail;
		existing.href = existing.href ?? candidate.href;
		if (candidate.source === "notification" && candidate.title) existing.title = candidate.title;
		if (!existing.pondName && candidate.pondName) existing.pondName = candidate.pondName;
		if (!existing.tenantName && candidate.tenantName) existing.tenantName = candidate.tenantName;
	}

	return sortIncidents([...byKey.values()]);
}

/**
 * Worst first, then oldest first. The commander reads the top of the list, and
 * inside one severity the thing that has been broken longest comes first. An
 * incident whose source cannot say when it started sorts after the dated ones in
 * its severity, because a guessed age is worse than a blank.
 */
export function sortIncidents(incidents: readonly Incident[]): Incident[] {
	return [...incidents].sort((a, b) => {
		const rank = INCIDENT_SEVERITY_ORDER[a.severity] - INCIDENT_SEVERITY_ORDER[b.severity];
		if (rank !== 0) return rank;
		if (a.since && b.since) {
			const age = a.since.getTime() - b.since.getTime();
			if (age !== 0) return age;
		} else if (a.since) {
			return -1;
		} else if (b.since) {
			return 1;
		}
		return (a.title ?? "").localeCompare(b.title ?? "", undefined, { sensitivity: "base" });
	});
}

export interface IncidentSummary {
	state: BandState;
	open: number;
	counts: Record<IncidentSeverity, number>;
	/** Sources that did not report; their conditions are missing from `open`. */
	failedSources: IncidentSource[];
}

const SEVERITY_BAND: Record<IncidentSeverity, BandState> = {
	critical: "critical",
	warning: "degraded",
	info: "ok",
};

/**
 * The queue's verdict.
 *
 * A missing source is `unknown`, so an empty queue is never rendered as "all
 * clear" when one of the four readers failed. A real warning or critical still
 * outranks that unknown, which is the same ordering `worstState` already uses.
 */
export function summarizeIncidents(
	incidents: readonly Incident[],
	failedSources: readonly IncidentSource[],
): IncidentSummary {
	const counts: Record<IncidentSeverity, number> = { critical: 0, warning: 0, info: 0 };
	for (const incident of incidents) counts[incident.severity] += 1;

	const states: BandState[] = incidents.map((incident) => SEVERITY_BAND[incident.severity]);
	if (failedSources.length > 0) states.push("unknown");

	return {
		state: worstState(states),
		open: incidents.length,
		counts,
		failedSources: [...failedSources],
	};
}

/** How long the condition has been open; null when the source cannot say. */
export function incidentAgeMs(since: Date | null, now: Date): number | null {
	if (!since) return null;
	return Math.max(0, now.getTime() - since.getTime());
}
