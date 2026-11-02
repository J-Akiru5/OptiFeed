/**
 * Status-band rules for the Platform Command Center (issue #479, M3C.2; plan
 * decisions T24–T26, open question O21).
 *
 * Four bands — Platform, Tenants, Devices, Security — each resolve to one of
 * four states:
 *
 *  - **ok** — every input is inside its healthy range;
 *  - **degraded** — something needs a human soon, but nothing is broken;
 *  - **critical** — a platform-level fault that is already hurting tenants;
 *  - **unknown** — the source failed, or it is too stale to trust.
 *
 * Two rules that the rest of the console depends on:
 *
 *  1. **Unknown outranks ok.** A failed query or a source that has not reported
 *     inside its freshness window can never be rendered as healthy, so its rank
 *     sits above `ok`. Anything genuinely worse (degraded, critical) still wins
 *     over an unknown, and the per-fact rows keep the unmeasured input visible.
 *  2. **No invented score.** A band is the worst of its facts, not a weighted
 *     average. O21 has not fixed tenant thresholds yet, so this file only
 *     encodes the ranges the existing sources already imply (the configured
 *     `device.status` policy, the job queue, the error register).
 *
 * Everything here is pure so each rule can be unit-tested without a database;
 * `status-bands.ts` does the querying and catches per-source failures.
 */

export type BandKey = "platform" | "tenants" | "devices" | "security";

export type BandState = "ok" | "degraded" | "critical" | "unknown";

/** One measured input behind a band. `value` is null when nothing reported. */
export interface BandFact {
	key: string;
	state: BandState;
	value: number | null;
	/** The boundary that produced the state, in the same unit as `value`. */
	threshold: number | null;
}

export interface StatusBand {
	key: BandKey;
	state: BandState;
	facts: BandFact[];
}

/** Rank, not a score: higher wins, and `unknown` never sinks to `ok`. */
const RANK: Record<BandState, number> = {
	ok: 0,
	unknown: 1,
	degraded: 2,
	critical: 3,
};

/**
 * Worst first. Shared by every worst-first list (fleet monitor, tenant health)
 * so "most urgent at the top" cannot drift between pages.
 */
export const BAND_STATE_ORDER: Record<BandState, number> = {
	critical: 0,
	degraded: 1,
	unknown: 2,
	ok: 3,
};

export function worstState(states: readonly BandState[]): BandState {
	return states.reduce<BandState>(
		(worst, state) => (RANK[state] > RANK[worst] ? state : worst),
		"ok",
	);
}

export function buildBand(key: BandKey, facts: readonly BandFact[]): StatusBand {
	return { key, state: worstState(facts.map((fact) => fact.state)), facts: [...facts] };
}

// ---------------------------------------------------------------------------
// Platform band: the job queue and the error register.
// ---------------------------------------------------------------------------

/** One failed job is worth a look; ten means the worker is not keeping up. */
export const PLATFORM_FAILED_JOBS_DEGRADED = 1;
export const PLATFORM_FAILED_JOBS_CRITICAL = 10;

/** A job queued this long is late; an hour means the worker is not draining. */
export const PLATFORM_QUEUED_JOB_DEGRADED_MIN = 15;
export const PLATFORM_QUEUED_JOB_CRITICAL_MIN = 60;

/**
 * Cron freshness is inferred from the rows each job writes (see
 * `platform/health.ts`), which is why a stale or absent timestamp is `unknown`:
 * the scheduler may be idle or dead and the rows cannot tell us which.
 */
export const CRON_DEGRADED_AFTER_MIN = 6 * 60;
export const CRON_UNKNOWN_AFTER_MIN = 24 * 60;

export const PLATFORM_UNRESOLVED_ERRORS_DEGRADED = 1;
export const PLATFORM_UNRESOLVED_ERRORS_CRITICAL = 10;

/** `null` means the source did not report; that is never healthy. */
export function failedJobsState(failed: number | null): BandState {
	if (failed === null) return "unknown";
	if (failed >= PLATFORM_FAILED_JOBS_CRITICAL) return "critical";
	if (failed >= PLATFORM_FAILED_JOBS_DEGRADED) return "degraded";
	return "ok";
}

export function queuedJobState(oldestAgeMin: number | null): BandState {
	if (oldestAgeMin === null) return "unknown";
	if (oldestAgeMin > PLATFORM_QUEUED_JOB_CRITICAL_MIN) return "critical";
	if (oldestAgeMin > PLATFORM_QUEUED_JOB_DEGRADED_MIN) return "degraded";
	return "ok";
}

export function cronState(lastActivityAgeMin: number | null): BandState {
	if (lastActivityAgeMin === null) return "unknown";
	if (lastActivityAgeMin > CRON_UNKNOWN_AFTER_MIN) return "unknown";
	if (lastActivityAgeMin > CRON_DEGRADED_AFTER_MIN) return "degraded";
	return "ok";
}

export function unresolvedErrorsState(count: number | null): BandState {
	if (count === null) return "unknown";
	if (count >= PLATFORM_UNRESOLVED_ERRORS_CRITICAL) return "critical";
	if (count >= PLATFORM_UNRESOLVED_ERRORS_DEGRADED) return "degraded";
	return "ok";
}

// ---------------------------------------------------------------------------
// Tenants band: organizations by status.
// ---------------------------------------------------------------------------

/**
 * A suspension is an intentional, audited admin action, and a pending deletion
 * is a scheduled one; neither is a platform fault. They are reported per tenant
 * so the operator can see them, and they lift the band to `degraded` because a
 * tenant stopped serving its farmers.
 */
export function tenantStatusState({
	suspended,
	pendingDeletion,
	total,
}: {
	suspended: number | null;
	pendingDeletion: number | null;
	total: number | null;
}): BandState {
	if (total === null || suspended === null || pendingDeletion === null) return "unknown";
	if (total === 0) return "unknown";
	if (suspended > 0 || pendingDeletion > 0) return "degraded";
	return "ok";
}

// ---------------------------------------------------------------------------
// Devices band: the configured `device.status` policy, applied by bucket.
// ---------------------------------------------------------------------------

export const DEVICES_OFFLINE_DEGRADED_PCT = 20;
export const DEVICES_OFFLINE_CRITICAL_PCT = 50;

/**
 * Percentages are of the devices that have ever reported. A fleet where no unit
 * has a heartbeat is `unknown`, not "0 % offline": there is nothing to measure.
 */
export function deviceFleetState({
	offline,
	reporting,
	total,
}: {
	offline: number | null;
	reporting: number | null;
	total: number | null;
}): BandState {
	if (total === null || offline === null || reporting === null) return "unknown";
	if (total === 0) return "unknown";
	if (reporting === 0) return "unknown";
	const pct = (offline / reporting) * 100;
	if (pct >= DEVICES_OFFLINE_CRITICAL_PCT) return "critical";
	if (pct >= DEVICES_OFFLINE_DEGRADED_PCT) return "degraded";
	return "ok";
}

// ---------------------------------------------------------------------------
// Security band: lockouts, temporary grants, approvals, MFA enrolment.
// ---------------------------------------------------------------------------

/** A temporary platform grant inside this window is worth chasing. */
export const SECURITY_GRANT_EXPIRY_WARN_DAYS = 7;

export function lockoutState(active: number | null): BandState {
	if (active === null) return "unknown";
	return active > 0 ? "degraded" : "ok";
}

export function grantExpiryState(nearExpiry: number | null): BandState {
	if (nearExpiry === null) return "unknown";
	return nearExpiry > 0 ? "degraded" : "ok";
}

export function pendingApprovalState(pending: number | null): BandState {
	if (pending === null) return "unknown";
	return pending > 0 ? "degraded" : "ok";
}

/**
 * MFA is not shipped yet (plan decision N2 / M3C.7), so "no admin enrolled" is
 * `unknown`: the console cannot claim the platform is protected *or* that it is
 * exposed. Once at least one admin has enrolled, an unenrolled admin is a real
 * gap and the fact becomes `degraded`.
 */
export function mfaState({
	unenrolled,
	enrolled,
}: {
	unenrolled: number | null;
	enrolled: number | null;
}): BandState {
	if (unenrolled === null || enrolled === null) return "unknown";
	if (enrolled === 0) return "unknown";
	return unenrolled > 0 ? "degraded" : "ok";
}
