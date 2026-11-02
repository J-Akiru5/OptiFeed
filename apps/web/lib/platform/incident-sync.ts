import { writePlatformAudit } from "@/lib/actions/platform/audit";
import {
	DEVICE_HEALTH_EVENT,
	type DeviceHealthReport,
	faultsFromMask,
	healthFromMetadata,
} from "@/lib/device-health-model";
import { type DeviceStatusPolicy, evaluateDeviceStatus } from "@/lib/device-status";
import {
	type ExistingTrackedIncident,
	type ObservedIncidentCondition,
	SYSTEM_ACTOR_ID,
	deviceOfflineIncidentKey,
	failedJobIncidentKey,
	faultIncidentKey,
	planIncidentSync,
	safeModeIncidentKey,
} from "@/lib/platform/incident-lifecycle-rules";
import { resolveFarmsToOrganizations } from "@/lib/platform/tenant-resolution";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
import type { Prisma } from "@prisma/client";

/**
 * Automatic incident open/resolve (issue #479, M3C.6; plan decisions O19/O20).
 *
 * The device watch already detects four conditions. This module turns each one
 * into a stored incident through a stable dedupe key, and closes it when the
 * condition clears. It is deliberately separate from the tenant notification
 * path: the cron route keeps creating exactly the Notification rows it created
 * before, so this adds no second alert.
 *
 * Honesty rules, same as the read model:
 *  - A source whose read failed is *not observed*, so its open incidents are
 *    left alone instead of being auto-resolved on missing evidence.
 *  - A condition that is still present refreshes `lastSeenAt`; it never opens a
 *    second incident (the unique dedupe key enforces the same rule in SQL).
 *  - A condition that returns after a resolve reopens the same row. That is a
 *    system transition with `actorId = null` and an `AUTO_OPENED` event.
 *
 * Every write is bounded. The cron route stays under its function cap because
 * each source is read once and at most `INCIDENT_SYNC_CHANGE_LIMIT` transitions
 * are committed per run; the remainder is reported as `deferred` and retried by
 * the next run.
 */

export const INCIDENT_SYNC_DEVICE_LIMIT = 1000;
export const INCIDENT_SYNC_HEALTH_LIMIT = 2000;
export const INCIDENT_SYNC_JOB_LIMIT = 50;
export const INCIDENT_SYNC_OPEN_LIMIT = 500;
/**
 * Writes per cron run. The device-watch function has a hard 10 s cap, so a large
 * fleet opens or closes at most this many incidents in one pass; the remainder
 * is reported as `deferred` and picked up by the next run.
 */
export const INCIDENT_SYNC_CHANGE_LIMIT = 50;

const AUTO_OPEN_NOTE = "Opened automatically by the device watch.";
const AUTO_REOPEN_NOTE = "The condition returned; the same incident was reopened automatically.";
const AUTO_RESOLVE_NOTE = "The condition cleared; the incident was resolved automatically.";

export interface SyncDevice {
	id: string;
	label: string;
	lastSeenAt: Date | null;
	pondId: string | null;
	pond: { id: string; name: string; ownerId: string } | null;
}

export interface SyncHealthRow {
	deviceId: string;
	metadata: unknown;
	createdAt: Date;
}

export interface SyncJob {
	id: string;
	type: string;
	error: string | null;
	ownerId: string;
	finishedAt: Date | null;
	createdAt: Date;
}

function deviceCondition(input: {
	device: SyncDevice | undefined;
	deviceId: string;
	tenantByFarm: ReadonlyMap<string, { id: string; name: string }>;
}): Pick<ObservedIncidentCondition, "orgId" | "farmId" | "deviceId" | "pondId"> {
	const device = input.device;
	const farmId = device?.pond?.ownerId ?? null;
	return {
		orgId: farmId ? (input.tenantByFarm.get(farmId)?.id ?? null) : null,
		farmId,
		deviceId: input.deviceId,
		pondId: device?.pond?.id ?? device?.pondId ?? null,
	};
}

/**
 * Build the conditions this run observed. Pure so the mapping from a device,
 * health row or failed job to an incident can be tested without a database.
 */
export function buildObservedConditions(input: {
	devices: readonly SyncDevice[];
	healthRows: readonly SyncHealthRow[];
	jobs: readonly SyncJob[];
	policy: DeviceStatusPolicy;
	tenantByFarm: ReadonlyMap<string, { id: string; name: string }>;
	now: Date;
}): ObservedIncidentCondition[] {
	const deviceById = new Map(input.devices.map((device) => [device.id, device]));
	const conditions: ObservedIncidentCondition[] = [];

	for (const device of input.devices) {
		// A unit that never reported is not "offline" here: the existing device
		// watch also requires a heartbeat, and a brand-new unit is not an outage.
		if (!device.lastSeenAt) continue;
		const state = evaluateDeviceStatus({
			lastSeenAt: device.lastSeenAt,
			now: input.now,
			policy: input.policy,
		});
		if (!state.isOffline) continue;

		conditions.push({
			dedupeKey: deviceOfflineIncidentKey(device.id),
			source: "DEVICE_OFFLINE",
			severity: "CRITICAL",
			title: `${device.label} is offline`,
			summary: null,
			...deviceCondition({
				device,
				deviceId: device.id,
				tenantByFarm: input.tenantByFarm,
			}),
			observedAt: input.now,
			metadata: {
				deviceId: device.id,
				label: device.label,
				lastSeenAt: device.lastSeenAt.toISOString(),
				detector: "device-watch",
			},
		});
	}

	for (const row of input.healthRows) {
		const device = deviceById.get(row.deviceId);
		const report: DeviceHealthReport = healthFromMetadata(row.metadata);
		if (report.safeMode) {
			conditions.push({
				dedupeKey: safeModeIncidentKey(row.deviceId),
				source: "SAFE_MODE",
				severity: "CRITICAL",
				title: `${device?.label ?? row.deviceId} is in safe mode`,
				summary: null,
				...deviceCondition({
					device,
					deviceId: row.deviceId,
					tenantByFarm: input.tenantByFarm,
				}),
				observedAt: input.now,
				metadata: {
					deviceId: row.deviceId,
					label: device?.label ?? null,
					safeMode: true,
					lastFault: report.lastFault,
					reportedAt: row.createdAt.toISOString(),
				},
			});
		}

		for (const fault of faultsFromMask(report.faultsPresent)) {
			if (fault === "safe_mode") continue;
			conditions.push({
				dedupeKey: faultIncidentKey(row.deviceId, fault),
				source: "FAULT",
				severity: "WARNING",
				title: `${device?.label ?? row.deviceId}: ${fault}`,
				summary: null,
				...deviceCondition({
					device,
					deviceId: row.deviceId,
					tenantByFarm: input.tenantByFarm,
				}),
				observedAt: input.now,
				metadata: {
					deviceId: row.deviceId,
					label: device?.label ?? null,
					fault,
					reportedAt: row.createdAt.toISOString(),
				},
			});
		}
	}

	for (const job of input.jobs) {
		const org = input.tenantByFarm.get(job.ownerId);
		conditions.push({
			dedupeKey: failedJobIncidentKey(job.id),
			source: "FAILED_JOB",
			severity: "WARNING",
			title: `Background job failed: ${job.type}`,
			summary: null,
			orgId: org?.id ?? null,
			farmId: job.ownerId,
			deviceId: null,
			pondId: null,
			observedAt: input.now,
			metadata: {
				jobId: job.id,
				jobType: job.type,
				error: job.error,
				finishedAt: (job.finishedAt ?? job.createdAt).toISOString(),
			},
		});
	}

	return conditions;
}

export interface PlatformIncidentSyncResult {
	opened: number;
	refreshed: number;
	reopened: number;
	resolved: number;
	/** True when a reader or write failed; the route reports it, never a false zero. */
	failed: boolean;
	/** True when an open-incident read hit its cap, so some rows were not evaluated. */
	truncated: boolean;
	/** Writes that did not fit the per-run budget; the next run retries them. */
	deferred: number;
	sources: { device: boolean; health: boolean; job: boolean };
}

type Attempt<T> = { ok: true; value: T } | { ok: false };

async function attempt<T>(run: () => Promise<T>): Promise<Attempt<T>> {
	try {
		return { ok: true, value: await run() };
	} catch {
		return { ok: false };
	}
}

function failedResult(sources: PlatformIncidentSyncResult["sources"]): PlatformIncidentSyncResult {
	return {
		opened: 0,
		refreshed: 0,
		reopened: 0,
		resolved: 0,
		failed: true,
		truncated: false,
		deferred: 0,
		sources,
	};
}

/** Merge the condition metadata into a Prisma JSON value. */
function json(metadata: Record<string, unknown>): Prisma.InputJsonValue {
	return metadata as Prisma.InputJsonValue;
}

/**
 * Run one bounded sync pass. Called by the device-watch cron; a failure is
 * reported in the result instead of taking the existing alert/housekeeping run
 * down with it.
 */
export async function syncPlatformIncidents(
	now: Date = new Date(),
): Promise<PlatformIncidentSyncResult> {
	let sources = { device: false, health: false, job: false };

	try {
		const [policyAttempt, devicesAttempt, healthAttempt, jobsAttempt] = await Promise.all([
			attempt(() => getDeviceStatusPolicy()),
			attempt(() =>
				prisma.energyDevice.findMany({
					orderBy: { label: "asc" },
					take: INCIDENT_SYNC_DEVICE_LIMIT + 1,
					select: {
						id: true,
						label: true,
						lastSeenAt: true,
						pondId: true,
						pond: { select: { id: true, name: true, ownerId: true } },
					},
				}),
			),
			attempt(() =>
				prisma.deviceStateEvent.findMany({
					where: { eventType: DEVICE_HEALTH_EVENT },
					orderBy: [{ deviceId: "asc" }, { createdAt: "desc" }],
					distinct: ["deviceId"],
					take: INCIDENT_SYNC_HEALTH_LIMIT + 1,
					select: { deviceId: true, metadata: true, createdAt: true },
				}),
			),
			attempt(() =>
				prisma.backgroundJob.findMany({
					where: { status: "failed" },
					orderBy: { finishedAt: "desc" },
					take: INCIDENT_SYNC_JOB_LIMIT + 1,
					select: {
						id: true,
						type: true,
						error: true,
						ownerId: true,
						createdAt: true,
						finishedAt: true,
					},
				}),
			),
		]);

		// A cap reached means the source may have more conditions than this run
		// saw. It is still read (observed conditions open/refresh), but it is not
		// *complete*, so an absent condition must not auto-resolve anything.
		const devicesIncomplete =
			devicesAttempt.ok && devicesAttempt.value.length > INCIDENT_SYNC_DEVICE_LIMIT;
		const healthIncomplete =
			healthAttempt.ok && healthAttempt.value.length > INCIDENT_SYNC_HEALTH_LIMIT;
		const jobsIncomplete = jobsAttempt.ok && jobsAttempt.value.length > INCIDENT_SYNC_JOB_LIMIT;

		const devices = devicesAttempt.ok
			? devicesAttempt.value.slice(0, INCIDENT_SYNC_DEVICE_LIMIT)
			: [];
		const healthRows = healthAttempt.ok
			? healthAttempt.value.slice(0, INCIDENT_SYNC_HEALTH_LIMIT)
			: [];
		const jobs = jobsAttempt.ok ? jobsAttempt.value.slice(0, INCIDENT_SYNC_JOB_LIMIT) : [];
		// Device conditions need both the policy and the device list; the health
		// and job readers stand alone.
		sources = {
			device: devicesAttempt.ok && policyAttempt.ok,
			health: healthAttempt.ok,
			job: jobsAttempt.ok,
		};

		const farmIds = [
			...new Set([
				...devices.flatMap((device) => (device.pond ? [device.pond.ownerId] : [])),
				...jobs.map((job) => job.ownerId),
			]),
		];
		const tenantsAttempt = await attempt(() => resolveFarmsToOrganizations(farmIds));
		const tenantByFarm = tenantsAttempt.ok
			? tenantsAttempt.value
			: new Map<string, { id: string; name: string }>();

		const observed = buildObservedConditions({
			devices,
			healthRows,
			jobs,
			// A failed policy makes `sources.device` false; the empty policy is only
			// used to build no device conditions, never to guess a window.
			policy: policyAttempt.ok
				? policyAttempt.value
				: { weakAfterMs: 0, offlineAfterMs: 0, graceMs: 0 },
			tenantByFarm,
			now,
		}).filter((condition) => sources.device || condition.source !== "DEVICE_OFFLINE");

		const observedKeys = [...new Set(observed.map((condition) => condition.dedupeKey))];

		const [openAttempt, keyedAttempt] = await Promise.all([
			attempt(() =>
				prisma.platformIncident.findMany({
					where: { status: { not: "RESOLVED" } },
					orderBy: { openedAt: "asc" },
					take: INCIDENT_SYNC_OPEN_LIMIT + 1,
					select: { id: true, dedupeKey: true, source: true, status: true, orgId: true },
				}),
			),
			observedKeys.length > 0
				? attempt(() =>
						prisma.platformIncident.findMany({
							where: { dedupeKey: { in: observedKeys } },
							take: observedKeys.length,
							select: { id: true, dedupeKey: true, source: true, status: true, orgId: true },
						}),
					)
				: Promise.resolve({ ok: true as const, value: [] }),
		]);

		if (!openAttempt.ok || !keyedAttempt.ok) return failedResult(sources);

		const truncated =
			openAttempt.value.length > INCIDENT_SYNC_OPEN_LIMIT ||
			devicesIncomplete ||
			healthIncomplete ||
			jobsIncomplete;
		const existingById = new Map<string, ExistingTrackedIncident>();
		for (const row of [
			...openAttempt.value.slice(0, INCIDENT_SYNC_OPEN_LIMIT),
			...keyedAttempt.value,
		]) {
			existingById.set(row.id, row);
		}

		const availableSources = new Set<ObservedIncidentCondition["source"]>();
		if (sources.device && !devicesIncomplete) availableSources.add("DEVICE_OFFLINE");
		if (sources.health && !healthIncomplete) {
			availableSources.add("SAFE_MODE");
			availableSources.add("FAULT");
		}
		if (sources.job && !jobsIncomplete) availableSources.add("FAILED_JOB");

		const plan = planIncidentSync({
			observed,
			existing: [...existingById.values()],
			availableSources,
		});

		// Priority under the per-run write budget: open, close, reopen, then
		// refresh. A missing refresh only leaves `lastSeenAt` one run stale.
		let remaining = INCIDENT_SYNC_CHANGE_LIMIT;
		const openOps = plan.open.slice(0, remaining);
		remaining -= openOps.length;
		const resolveOps = plan.resolve.slice(0, remaining);
		remaining -= resolveOps.length;
		const reopenOps = plan.reopen.slice(0, remaining);
		remaining -= reopenOps.length;
		const refreshOps = plan.refresh.slice(0, remaining);
		const deferred =
			plan.open.length +
			plan.resolve.length +
			plan.reopen.length +
			plan.refresh.length -
			(openOps.length + resolveOps.length + reopenOps.length + refreshOps.length);

		let opened = 0;
		for (const condition of openOps) {
			await prisma.$transaction(async (tx) => {
				const created = await tx.platformIncident.create({
					data: {
						dedupeKey: condition.dedupeKey,
						source: condition.source,
						severity: condition.severity,
						status: "NEW",
						title: condition.title,
						summary: condition.summary,
						orgId: condition.orgId,
						farmId: condition.farmId,
						deviceId: condition.deviceId,
						pondId: condition.pondId,
						openedAt: now,
						lastSeenAt: now,
						metadata: json(condition.metadata),
					},
					select: { id: true },
				});
				await tx.platformIncidentEvent.create({
					data: {
						incidentId: created.id,
						type: "AUTO_OPENED",
						fromStatus: null,
						toStatus: "NEW",
						actorId: null,
						note: AUTO_OPEN_NOTE,
						metadata: json({ ...condition.metadata, dedupeKey: condition.dedupeKey }),
					},
				});
				await writePlatformAudit(tx, {
					actorUserId: SYSTEM_ACTOR_ID,
					action: "platform.incident.auto_open",
					targetType: "platform_incident",
					targetId: created.id,
					orgId: condition.orgId,
					reason: AUTO_OPEN_NOTE,
					before: json({ status: null }),
					after: json({
						status: "NEW",
						source: condition.source,
						dedupeKey: condition.dedupeKey,
					}),
				});
			});
			opened += 1;
		}

		let refreshed = 0;
		for (const entry of refreshOps) {
			const updated = await prisma.platformIncident.updateMany({
				where: { id: entry.incidentId },
				data: {
					lastSeenAt: now,
					severity: entry.condition.severity,
					title: entry.condition.title,
					summary: entry.condition.summary,
					metadata: json(entry.condition.metadata),
				},
			});
			if (updated.count === 1) refreshed += 1;
		}

		let reopened = 0;
		for (const entry of reopenOps) {
			const done = await prisma.$transaction(async (tx) => {
				const updated = await tx.platformIncident.updateMany({
					where: { id: entry.incidentId, status: "RESOLVED" },
					data: {
						status: "NEW",
						openedAt: now,
						lastSeenAt: now,
						severity: entry.condition.severity,
						title: entry.condition.title,
						summary: entry.condition.summary,
						acknowledgedAt: null,
						resolvedAt: null,
						escalatedAt: null,
						ackDueAt: null,
						ownerId: null,
						metadata: json(entry.condition.metadata),
					},
				});
				if (updated.count !== 1) return false;

				await tx.platformIncidentEvent.create({
					data: {
						incidentId: entry.incidentId,
						type: "AUTO_OPENED",
						fromStatus: "RESOLVED",
						toStatus: "NEW",
						actorId: null,
						note: AUTO_REOPEN_NOTE,
						metadata: json({
							...entry.condition.metadata,
							dedupeKey: entry.condition.dedupeKey,
						}),
					},
				});
				await writePlatformAudit(tx, {
					actorUserId: SYSTEM_ACTOR_ID,
					action: "platform.incident.auto_open",
					targetType: "platform_incident",
					targetId: entry.incidentId,
					orgId: entry.condition.orgId,
					reason: AUTO_REOPEN_NOTE,
					before: json({ status: "RESOLVED" }),
					after: json({
						status: "NEW",
						source: entry.condition.source,
						dedupeKey: entry.condition.dedupeKey,
					}),
				});
				return true;
			});
			if (done) reopened += 1;
		}

		let resolved = 0;
		for (const entry of resolveOps) {
			const done = await prisma.$transaction(async (tx) => {
				const updated = await tx.platformIncident.updateMany({
					where: { id: entry.incidentId, status: entry.from },
					data: { status: "RESOLVED", resolvedAt: now },
				});
				if (updated.count !== 1) return false;

				await tx.platformIncidentEvent.create({
					data: {
						incidentId: entry.incidentId,
						type: "AUTO_RESOLVED",
						fromStatus: entry.from,
						toStatus: "RESOLVED",
						actorId: null,
						note: AUTO_RESOLVE_NOTE,
						metadata: json({ resolvedAt: now.toISOString() }),
					},
				});
				await writePlatformAudit(tx, {
					actorUserId: SYSTEM_ACTOR_ID,
					action: "platform.incident.auto_resolve",
					targetType: "platform_incident",
					targetId: entry.incidentId,
					orgId: entry.orgId,
					reason: AUTO_RESOLVE_NOTE,
					before: json({ status: entry.from }),
					after: json({ status: "RESOLVED" }),
				});
				return true;
			});
			if (done) resolved += 1;
		}

		return {
			opened,
			refreshed,
			reopened,
			resolved,
			failed: false,
			truncated,
			deferred,
			sources,
		};
	} catch (error) {
		console.warn(
			"[platform-incidents] sync failed:",
			error instanceof Error ? error.message : String(error),
		);
		return failedResult(sources);
	}
}
