import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { evaluateDeviceStatus } from "@/lib/device-status";
import {
	type BandFact,
	type BandKey,
	CRON_UNKNOWN_AFTER_MIN,
	DEVICES_OFFLINE_CRITICAL_PCT,
	PLATFORM_FAILED_JOBS_CRITICAL,
	PLATFORM_QUEUED_JOB_CRITICAL_MIN,
	PLATFORM_UNRESOLVED_ERRORS_CRITICAL,
	SECURITY_GRANT_EXPIRY_WARN_DAYS,
	type StatusBand,
	buildBand,
	cronState,
	deviceFleetState,
	failedJobsState,
	grantExpiryState,
	lockoutState,
	mfaState,
	pendingApprovalState,
	queuedJobState,
	tenantStatusState,
	unresolvedErrorsState,
} from "@/lib/platform/status-band-rules";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";

/**
 * The four status bands on the Platform Command Center (issue #479, M3C.2).
 *
 * Read-only and platform-gated. Each band is one `Promise.all` of small,
 * bounded aggregates over an existing data layer — no new tables, no polling,
 * and the device band reuses the configured `device.status` policy through
 * `evaluateDeviceStatus` instead of copying the offline thresholds.
 *
 * Failure handling is the point of the feature: a band whose source throws is
 * returned with a single `source` fact in `unknown`, so a query that breaks can
 * never render as "OK". The same applies to a source that has stopped
 * reporting: cron freshness older than the documented window is `unknown`
 * rather than healthy.
 */

const MS_PER_MIN = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MIN;

export interface StatusBandsResult {
	bands: StatusBand[];
	/** When the bands were computed; the page shows it so a stale screenshot reads as stale. */
	checkedAt: Date;
}

function minutesSince(at: Date, now: Date): number {
	return Math.max(0, Math.round((now.getTime() - at.getTime()) / MS_PER_MIN));
}

function failedBand(key: BandKey): StatusBand {
	const fact: BandFact = { key: "source", state: "unknown", value: null, threshold: null };
	return buildBand(key, [fact]);
}

async function platformBand(now: Date): Promise<StatusBand> {
	const [failed, oldestQueued, lastStarted, unresolved] = await Promise.all([
		prisma.backgroundJob.count({ where: { status: "failed" } }),
		prisma.backgroundJob.findFirst({
			where: { status: "queued" },
			orderBy: { createdAt: "asc" },
			select: { createdAt: true },
		}),
		prisma.backgroundJob.findFirst({
			where: { startedAt: { not: null } },
			orderBy: { startedAt: "desc" },
			select: { startedAt: true },
		}),
		prisma.errorEvent.count({ where: { resolved: false } }),
	]);

	// An empty queue is a measurement (0 minutes), not a missing one.
	const queuedAgeMin = oldestQueued ? minutesSince(oldestQueued.createdAt, now) : 0;
	const cronAgeMin = lastStarted?.startedAt ? minutesSince(lastStarted.startedAt, now) : null;

	return buildBand("platform", [
		{
			key: "failedJobs",
			state: failedJobsState(failed),
			value: failed,
			threshold: PLATFORM_FAILED_JOBS_CRITICAL,
		},
		{
			key: "oldestQueued",
			state: queuedJobState(queuedAgeMin),
			value: queuedAgeMin,
			threshold: PLATFORM_QUEUED_JOB_CRITICAL_MIN,
		},
		{
			key: "cronFreshness",
			state: cronState(cronAgeMin),
			value: cronAgeMin,
			threshold: CRON_UNKNOWN_AFTER_MIN,
		},
		{
			key: "unresolvedErrors",
			state: unresolvedErrorsState(unresolved),
			value: unresolved,
			threshold: PLATFORM_UNRESOLVED_ERRORS_CRITICAL,
		},
	]);
}

async function tenantsBand(): Promise<StatusBand> {
	const groups = await prisma.organization.groupBy({ by: ["status"], _count: { _all: true } });
	const countOf = (status: string): number =>
		groups.find((group) => group.status === status)?._count._all ?? 0;

	const active = countOf("ACTIVE");
	const suspended = countOf("SUSPENDED");
	const pendingDeletion = countOf("PENDING_DELETION");
	// PURGED organizations are gone from the operator's point of view.
	const total = active + suspended + pendingDeletion;

	return buildBand("tenants", [
		{
			key: "organizations",
			state: tenantStatusState({ suspended: 0, pendingDeletion: 0, total }),
			value: total,
			threshold: null,
		},
		{
			key: "suspended",
			state: tenantStatusState({ suspended, pendingDeletion: 0, total }),
			value: suspended,
			threshold: 1,
		},
		{
			key: "pendingDeletion",
			state: tenantStatusState({ suspended: 0, pendingDeletion, total }),
			value: pendingDeletion,
			threshold: 1,
		},
	]);
}

async function devicesBand(now: Date): Promise<StatusBand> {
	const [policy, devices] = await Promise.all([
		getDeviceStatusPolicy(),
		prisma.energyDevice.findMany({ select: { lastSeenAt: true } }),
	]);

	let offline = 0;
	let reporting = 0;
	for (const device of devices) {
		if (device.lastSeenAt) reporting += 1;
		const status = evaluateDeviceStatus({ lastSeenAt: device.lastSeenAt, now, policy });
		if (status.isOffline) offline += 1;
	}

	const offlinePct = reporting > 0 ? Math.round((offline / reporting) * 1000) / 10 : null;

	return buildBand("devices", [
		{
			key: "offlineDevices",
			state: deviceFleetState({ offline, reporting, total: devices.length }),
			value: offlinePct,
			threshold: DEVICES_OFFLINE_CRITICAL_PCT,
		},
		{
			key: "offlineWindow",
			state: deviceFleetState({ offline, reporting, total: devices.length }),
			value: Math.round(policy.offlineAfterMs / MS_PER_MIN),
			threshold: null,
		},
	]);
}

async function securityBand(now: Date): Promise<StatusBand> {
	const expiryCutoff = new Date(now.getTime() + SECURITY_GRANT_EXPIRY_WARN_DAYS * MS_PER_DAY);

	const [farmLockouts, ipLockouts, nearExpiryGrants, pendingApprovals, admins, enrolled] =
		await Promise.all([
			prisma.userLockout.count({ where: { lockedUntil: { gt: now } } }),
			prisma.loginLockout.count({ where: { lockedUntil: { gt: now } } }),
			prisma.platformAdmin.count({
				where: { revokedAt: null, expiresAt: { not: null, lte: expiryCutoff } },
			}),
			prisma.energyDevice.count({ where: { approvalStatus: "PENDING" } }),
			prisma.platformAdmin.count({ where: { revokedAt: null } }),
			prisma.platformAdmin.count({ where: { revokedAt: null, mfaEnrolledAt: { not: null } } }),
		]);

	const lockouts = farmLockouts + ipLockouts;
	const unenrolled = Math.max(0, admins - enrolled);

	return buildBand("security", [
		{ key: "lockouts", state: lockoutState(lockouts), value: lockouts, threshold: 1 },
		{
			key: "grantsNearExpiry",
			state: grantExpiryState(nearExpiryGrants),
			value: nearExpiryGrants,
			threshold: SECURITY_GRANT_EXPIRY_WARN_DAYS,
		},
		{
			key: "pendingApprovals",
			state: pendingApprovalState(pendingApprovals),
			value: pendingApprovals,
			threshold: 1,
		},
		{
			key: "adminsWithoutMfa",
			state: mfaState({ unenrolled, enrolled }),
			value: unenrolled,
			threshold: 1,
		},
	]);
}

/** The band order the page renders, worst-first is left to the reader. */
export const BAND_KEYS: readonly BandKey[] = ["platform", "tenants", "devices", "security"];

export async function getStatusBands(now: Date = new Date()): Promise<StatusBandsResult> {
	// The layout and the page both gate; this keeps the data layer safe on its own.
	await requirePlatformAdmin();

	const settled = await Promise.allSettled([
		platformBand(now),
		tenantsBand(),
		devicesBand(now),
		securityBand(now),
	]);

	const bands = settled.map((result, index) =>
		result.status === "fulfilled" ? result.value : failedBand(BAND_KEYS[index] as BandKey),
	);

	return { bands, checkedAt: now };
}
