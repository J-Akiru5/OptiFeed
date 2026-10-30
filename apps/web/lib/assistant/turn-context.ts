import { getCurrentPondOwnerIdSafe } from "@/lib/auth/session";
import { utcDateToFarmDateTime } from "@/lib/calendar/datetime";
import { dateToFarmDateOnly } from "@/lib/crop-cycle/dates";
import { evaluateDeviceStatus } from "@/lib/device-status";
import { getActivePondId } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
import type { AssistantCaller } from "./caller";
import type { AssistantTurnContext } from "./planner";
import type { AssistantProposalContext } from "./types";

export interface AssistantTurnData {
	turn: AssistantTurnContext;
	proposal: AssistantProposalContext;
	pondId: string | null;
	orgId: string | null;
}

/**
 * The small, read-only snapshot the planner and the proposal cards need.
 *
 * Deliberately independent of `getActivePond()`: that helper redirects when a
 * caller has no farm, which is wrong inside a route handler (and a platform
 * admin with no tenant is a valid caller). Every read here is scoped to the
 * caller's own farm.
 */
export async function buildAssistantTurnData(
	locale: string,
	caller: AssistantCaller,
): Promise<AssistantTurnData> {
	const ownerId = await getCurrentPondOwnerIdSafe();
	const statusPolicy = await getDeviceStatusPolicy();

	let pondId: string | null = null;
	let pondName: string | null = null;
	let deviceId: string | null = null;
	let deviceLabel: string | null = null;
	let deviceOnline: boolean | null = null;
	let devicePaused: boolean | null = null;
	let hopperLevelPct: number | null = null;
	let currentGrams: number | null = null;
	let currentFeedsPerDay: number | null = null;
	let currentRatePct: number | null = null;
	let pondList: Array<{ id: string; name: string; status: string }> = [];

	if (ownerId) {
		const ponds = await prisma.pond.findMany({
			where: { ownerId, status: { in: ["ACTIVE", "ARCHIVED"] } },
			orderBy: { createdAt: "asc" },
			select: { id: true, name: true, status: true, feedsPerDay: true, feedingRatePct: true },
		});
		pondList = ponds.map((row) => ({ id: row.id, name: row.name, status: row.status }));
		// `status` is always present from the database; treating an absent value
		// as active keeps older partial fixtures/read models working.
		const activePonds = ponds.filter((row) => row.status !== "ARCHIVED");
		const selectedId = await getActivePondId();
		const pond = activePonds.find((row) => row.id === selectedId) ?? activePonds[0] ?? null;
		if (pond) {
			pondId = pond.id;
			pondName = pond.name;
			currentFeedsPerDay = pond.feedsPerDay;
			currentRatePct = pond.feedingRatePct;

			const device = await prisma.energyDevice.findFirst({
				where: { pondId: pond.id },
				orderBy: { createdAt: "asc" },
				select: {
					id: true,
					label: true,
					isPaused: true,
					feedLevelPercent: true,
					lastSeenAt: true,
					gramsPerFeeding: true,
				},
			});
			if (device) {
				deviceId = device.id;
				deviceLabel = device.label;
				devicePaused = device.isPaused;
				hopperLevelPct = device.feedLevelPercent;
				currentGrams = device.gramsPerFeeding;
				deviceOnline = !evaluateDeviceStatus({
					lastSeenAt: device.lastSeenAt,
					now: new Date(),
					policy: statusPolicy,
				}).isOffline;
			}

			const schedule = await resolveCurrentSchedule(pond.id, deviceId);
			if (schedule) {
				currentFeedsPerDay = schedule.feedsPerDay;
				currentRatePct = schedule.feedingRatePct;
			}
		}
	}

	let orgId: string | null = null;
	try {
		const membership = await prisma.membership.findFirst({
			where: { userId: caller.userId, revokedAt: null },
			orderBy: { createdAt: "asc" },
			select: { orgId: true },
		});
		orgId = membership?.orgId ?? null;
	} catch {
		orgId = null;
	}

	let openTasks: Array<{ id: string; title: string; startsAt: string }> = [];
	if (pondId) {
		try {
			const tasks = await prisma.pondEvent.findMany({
				where: { pondId, kind: "TASK", status: "PLANNED" },
				orderBy: { startsAt: "asc" },
				take: 10,
				select: { id: true, title: true, startsAt: true },
			});
			openTasks = tasks.map((task) => ({
				id: task.id,
				title: task.title,
				startsAt: task.startsAt.toISOString().slice(0, 10),
			}));
		} catch {
			openTasks = [];
		}
	}

	let calendarEvents: Array<{
		id: string;
		title: string;
		startsAt: string;
		kind: string;
	}> = [];
	if (pondId) {
		try {
			const events = await prisma.pondEvent.findMany({
				where: { pondId, status: "PLANNED" },
				orderBy: { startsAt: "asc" },
				take: 10,
				select: { id: true, title: true, startsAt: true, kind: true, allDay: true },
			});
			calendarEvents = events.map((event) => ({
				id: event.id,
				title: event.title,
				startsAt: event.allDay
					? dateToFarmDateOnly(event.startsAt)
					: utcDateToFarmDateTime(event.startsAt),
				kind: event.kind,
			}));
		} catch {
			calendarEvents = [];
		}
	}

	let samples: Array<{ id: string; date: string; avgWeightG: number; sampleCount: number }> = [];
	if (pondId) {
		try {
			const rows = await prisma.biomassLog.findMany({
				where: { pondId },
				orderBy: { recordedAt: "desc" },
				take: 5,
				select: { id: true, recordedAt: true, avgWeightKg: true, sampleCount: true },
			});
			samples = rows.map((row) => ({
				id: row.id,
				date: dateToFarmDateOnly(row.recordedAt),
				avgWeightG: Math.round(row.avgWeightKg * 1000 * 10) / 10,
				sampleCount: row.sampleCount,
			}));
		} catch {
			samples = [];
		}
	}

	let members: Array<{ userId: string; name: string; role: string }> = [];
	if (caller.isTenantAdmin && orgId) {
		try {
			const rows = await prisma.membership.findMany({
				where: { orgId, revokedAt: null },
				orderBy: { createdAt: "asc" },
				select: { userId: true, role: true },
			});
			const users = await prisma.user.findMany({
				where: { id: { in: [...new Set(rows.map((row) => row.userId))] } },
				select: { id: true, displayName: true, farmId: true },
			});
			const nameByUser = new Map(users.map((user) => [user.id, user.displayName ?? user.farmId]));
			members = rows.map((row) => ({
				userId: row.userId,
				name: nameByUser.get(row.userId) ?? row.userId,
				role: row.role,
			}));
		} catch {
			members = [];
		}
	}

	let organizations: Array<{ id: string; name: string; status: string }> = [];
	let devices: Array<{
		id: string;
		label: string;
		mac: string;
		isPaused: boolean;
		pondName: string | null;
	}> = [];
	let platformUsers: Array<{
		userId: string;
		farmId: string;
		name: string;
		platformAdmin: boolean;
	}> = [];
	if (caller.isPlatformAdmin) {
		try {
			const rows = await prisma.organization.findMany({
				orderBy: { name: "asc" },
				take: 50,
				select: { id: true, name: true, status: true },
			});
			organizations = rows.map((org) => ({ id: org.id, name: org.name, status: org.status }));
		} catch {
			organizations = [];
		}

		try {
			const rows = await prisma.energyDevice.findMany({
				orderBy: { createdAt: "desc" },
				take: 50,
				select: {
					id: true,
					label: true,
					mac: true,
					isPaused: true,
					pond: { select: { name: true } },
				},
			});
			devices = rows.map((device) => ({
				id: device.id,
				label: device.label,
				mac: device.mac,
				isPaused: device.isPaused,
				pondName: device.pond?.name ?? null,
			}));
		} catch {
			devices = [];
		}

		try {
			const users = await prisma.user.findMany({
				orderBy: { createdAt: "asc" },
				take: 50,
				select: { id: true, farmId: true, displayName: true },
			});
			const grants = users.length
				? await prisma.platformAdmin.findMany({
						where: { userId: { in: users.map((user) => user.id) } },
						select: { userId: true, revokedAt: true, expiresAt: true },
					})
				: [];
			const now = Date.now();
			const activeAdmins = new Set(
				grants
					.filter(
						(grant) => !grant.revokedAt && (!grant.expiresAt || grant.expiresAt.getTime() > now),
					)
					.map((grant) => grant.userId),
			);
			platformUsers = users.map((user) => ({
				userId: user.id,
				farmId: user.farmId,
				name: user.displayName ?? user.farmId,
				platformAdmin: activeAdmins.has(user.id),
			}));
		} catch {
			platformUsers = [];
		}
	}

	return {
		turn: {
			pondName,
			currentGrams,
			currentFeedsPerDay,
			currentRatePct,
			deviceLabel,
			deviceOnline,
			devicePaused,
			hopperLevelPct,
			orgName: caller.orgName,
			locale,
			openTasks,
			ponds: pondList,
			calendarEvents,
			samples,
			members,
			organizations,
			devices,
			platformUsers,
		},
		proposal: {
			pondName,
			orgName: caller.orgName,
			deviceLabel,
			currentGrams,
			currentFeedsPerDay,
			currentRatePct,
		},
		pondId,
		orgId,
	};
}
