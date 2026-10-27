import { getCurrentPondOwnerIdSafe } from "@/lib/auth/session";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { getActivePondId } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
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

	if (ownerId) {
		const ponds = await prisma.pond.findMany({
			where: { ownerId, status: "ACTIVE" },
			orderBy: { createdAt: "asc" },
			select: { id: true, name: true, feedsPerDay: true, feedingRatePct: true },
		});
		const selectedId = await getActivePondId();
		const pond = ponds.find((row) => row.id === selectedId) ?? ponds[0] ?? null;
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
				deviceOnline =
					!!device.lastSeenAt && Date.now() - device.lastSeenAt.getTime() <= OFFLINE_THRESHOLD_MS;
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
			members,
			organizations,
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
