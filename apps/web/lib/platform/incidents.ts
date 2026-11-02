import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import type { DeviceStatusPolicy } from "@/lib/device-status";
import {
	type Incident,
	type IncidentCandidate,
	type IncidentSummary,
	buildDeviceIncidents,
	buildErrorIncidents,
	buildJobIncidents,
	buildNotificationIncidents,
	dedupeIncidents,
	summarizeIncidents,
} from "@/lib/platform/incident-rules";
import { resolveFarmsToOrganizations } from "@/lib/platform/tenant-resolution";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";

/**
 * Incident queue loader (issue #479, M3C.5).
 *
 * A read model over four sources that already exist — open pond notifications,
 * unresolved error-register rows, failed background jobs and the silent units
 * behind the fleet monitor. Nothing is written, no table is added, and there is
 * no polling: the page renders what the query saw and stamps the time it looked.
 *
 * Every source is read inside its own attempt, so one broken reader cannot take
 * the queue down *or* make it look quiet. A failed source is named in
 * `sourceStates` and its incidents are simply absent — the summary then refuses
 * to say `ok`, which is the same invariant the status bands and the fleet
 * monitor enforce. The device policy is read through `getDeviceStatusPolicy`, so
 * an unreadable setting degrades the device source instead of guessing windows.
 *
 * All queries are bounded, and `truncated` says when a cap was reached.
 */

export const INCIDENT_LIMIT = 200;
export const INCIDENT_DEVICE_LIMIT = 1000;
export const INCIDENT_JOB_LIMIT = 50;

export type SourceState = Record<"device" | "notification" | "error" | "job", boolean>;

export interface IncidentQueue {
	checkedAt: Date;
	incidents: Incident[];
	summary: IncidentSummary;
	/** True when any source hit its cap, so the queue may be incomplete. */
	truncated: boolean;
	/** False when the device policy could not be read. */
	policyAvailable: boolean;
	/** False means the source did not report; the page says which. */
	sourceStates: SourceState;
}

type Attempt<T> = { ok: true; value: T } | { ok: false };

async function attempt<T>(run: () => Promise<T>): Promise<Attempt<T>> {
	try {
		return { ok: true, value: await run() };
	} catch {
		return { ok: false };
	}
}

const ALL_SOURCES_FAILED: SourceState = {
	device: false,
	notification: false,
	error: false,
	job: false,
};

function emptyQueue(now: Date): IncidentQueue {
	return {
		checkedAt: now,
		incidents: [],
		summary: summarizeIncidents([], ["device", "notification", "error", "job"]),
		truncated: false,
		policyAvailable: false,
		sourceStates: { ...ALL_SOURCES_FAILED },
	};
}

export async function getIncidentQueue(now: Date = new Date()): Promise<IncidentQueue> {
	await requirePlatformAdmin();

	try {
		const [policyAttempt, devicesAttempt, notificationsAttempt, errorsAttempt, jobsAttempt] =
			await Promise.all([
				attempt<DeviceStatusPolicy>(() => getDeviceStatusPolicy()),
				attempt(() =>
					prisma.energyDevice.findMany({
						orderBy: { label: "asc" },
						take: INCIDENT_DEVICE_LIMIT + 1,
						select: {
							id: true,
							label: true,
							lastSeenAt: true,
							pond: { select: { id: true, name: true, ownerId: true } },
						},
					}),
				),
				attempt(() =>
					prisma.notification.findMany({
						where: { acknowledgedAt: null, autoCleared: false },
						orderBy: { createdAt: "desc" },
						take: INCIDENT_LIMIT + 1,
						select: {
							id: true,
							pondId: true,
							tier: true,
							category: true,
							message: true,
							createdAt: true,
							pond: { select: { id: true, name: true, ownerId: true } },
						},
					}),
				),
				attempt(() =>
					prisma.errorEvent.findMany({
						where: { resolved: false },
						orderBy: { lastSeenAt: "desc" },
						take: INCIDENT_LIMIT + 1,
						select: { id: true, message: true, severity: true, firstSeenAt: true, count: true },
					}),
				),
				attempt(() =>
					prisma.backgroundJob.findMany({
						where: { status: "failed" },
						orderBy: { finishedAt: "desc" },
						take: INCIDENT_JOB_LIMIT,
						select: { id: true, type: true, error: true, createdAt: true, finishedAt: true },
					}),
				),
			]);

		const devices = devicesAttempt.ok ? devicesAttempt.value : [];
		const notifications = notificationsAttempt.ok ? notificationsAttempt.value : [];
		const errors = errorsAttempt.ok ? errorsAttempt.value : [];
		const jobs = jobsAttempt.ok ? jobsAttempt.value : [];
		const policy = policyAttempt.ok ? policyAttempt.value : null;

		// Tenant attribution is one more query, shared by devices and notifications.
		// If it fails the conditions are still real, but their tenant cannot be
		// named — so both sources are reported as not fully reported rather than
		// being shown under a guessed tenant.
		const farmIds = [
			...new Set(
				[...devices, ...notifications].flatMap((row) => (row.pond ? [row.pond.ownerId] : [])),
			),
		];
		const tenantsAttempt = await attempt(() => resolveFarmsToOrganizations(farmIds));
		const tenantByFarm = tenantsAttempt.ok
			? tenantsAttempt.value
			: new Map<string, { name: string }>();
		const tenantFor = (farmId: string | null | undefined) =>
			farmId ? (tenantByFarm.get(farmId)?.name ?? null) : null;

		const truncated =
			devices.length > INCIDENT_DEVICE_LIMIT ||
			notifications.length > INCIDENT_LIMIT ||
			errors.length > INCIDENT_LIMIT;

		const candidates: IncidentCandidate[] = [];
		if (policy) {
			candidates.push(
				...buildDeviceIncidents(
					devices.slice(0, INCIDENT_DEVICE_LIMIT).map((device) => ({
						id: device.id,
						label: device.label,
						pondId: device.pond?.id ?? null,
						pondName: device.pond?.name ?? null,
						tenantName: tenantFor(device.pond?.ownerId),
						lastSeenAt: device.lastSeenAt,
					})),
					now,
					policy,
				),
			);
		}
		candidates.push(
			...buildNotificationIncidents(
				notifications.slice(0, INCIDENT_LIMIT).map((row) => ({
					id: row.id,
					pondId: row.pond?.id ?? null,
					pondName: row.pond?.name ?? null,
					tenantName: tenantFor(row.pond?.ownerId),
					tier: row.tier,
					category: row.category,
					message: row.message,
					createdAt: row.createdAt,
				})),
			),
			...buildErrorIncidents(errors.slice(0, INCIDENT_LIMIT)),
			...buildJobIncidents(jobs),
		);

		const incidents = dedupeIncidents(candidates);

		const sourceStates: SourceState = {
			// Devices and notifications both need the tenant mapping: without it a
			// condition cannot be attributed, and an unattributed row is not reported.
			device: devicesAttempt.ok && policyAttempt.ok && tenantsAttempt.ok,
			notification: notificationsAttempt.ok && tenantsAttempt.ok,
			error: errorsAttempt.ok,
			job: jobsAttempt.ok,
		};
		const failedSources = (Object.keys(sourceStates) as (keyof SourceState)[]).filter(
			(source) => !sourceStates[source],
		);

		return {
			checkedAt: now,
			incidents,
			summary: summarizeIncidents(incidents, failedSources),
			truncated,
			policyAvailable: policy !== null,
			sourceStates,
		};
	} catch {
		return emptyQueue(now);
	}
}
