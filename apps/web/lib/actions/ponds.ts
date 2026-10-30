"use server";

import { writePlatformAudit } from "@/lib/actions/platform/audit";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { isStepUpRequiredError, withStepUp } from "@/lib/auth/step-up";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";
import { addDays, dateOnlyToUtcDate, daysBetween, todayDateOnly } from "@/lib/crop-cycle/dates";
import { dateOnlySchema } from "@/lib/crop-cycle/schema";
import { syncDeviceGramsForPond } from "@/lib/feed-grams";
import {
	MAX_DISPENSE_MS,
	feedingRatePctSchema,
	feedsPerDaySchema,
	formatZodError,
	populationSchema,
	resolveDailyCapG,
} from "@/lib/limits";
import prisma from "@/lib/prisma";
import { getFeedingLimits } from "@/lib/settings/feeding-caps";
import { ORG_SETTINGS_DEFAULTS, getOrgSettings } from "@/lib/settings/org";
import type { PondStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Tenant pond management (#202 / decision E22).
 *
 * Every pond mutation lives here rather than in `lib/actions/admin.ts`: the
 * console needs a real detail, create, edit and delete surface, and isolating
 * the new paths keeps the existing list read (`getPonds`) unchanged.
 *
 * Guards are the tenant ones: `requireTenantAdmin()` for the caller's
 * membership, `manage_farms_ponds` for the operation, and every target is
 * checked against `resolveOrgScope()` so another organization's ids are simply
 * not found. Mutations write one `PlatformAuditLog` row (the only audit table)
 * with the affected org, and device moves/unassigns also append a
 * `DeviceStateEvent` so the device timeline explains the change.
 *
 * Deletion is deliberately narrow: a pond with any history or hardware is
 * archived instead. A real delete needs the typed pond name and a fresh
 * step-up, and the blockers are re-checked inside the transaction.
 */

const POND_NAME_MAX = 80;
const SAMPLE_INTERVAL_MIN = 1;
const SAMPLE_INTERVAL_MAX = 365;
const DEFAULT_GROW_OUT_DAYS = 135;
const AUDIT_REASON = "Tenant admin changed pond management data";

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

const scheduleFields = {
	scheduleStart: z.string().regex(hhmm, "Schedule start must be a time in HH:MM format"),
	scheduleEnd: z.string().regex(hhmm, "Schedule end must be a time in HH:MM format"),
	feedsPerDay: feedsPerDaySchema,
};

const createPondSchema = z
	.object({
		name: z
			.string("Pond name is required")
			.trim()
			.min(1, "Pond name is required")
			.max(POND_NAME_MAX, `Pond name cannot exceed ${POND_NAME_MAX} characters`),
		ownerFarmId: z.string().min(1, "Choose a farm owner"),
		population: populationSchema.nullish(),
		sampleIntervalDays: z
			.number("Sample interval must be a number")
			.int("Sample interval must be a whole number")
			.min(SAMPLE_INTERVAL_MIN, `Sample interval must be at least ${SAMPLE_INTERVAL_MIN} day`)
			.max(SAMPLE_INTERVAL_MAX, `Sample interval cannot exceed ${SAMPLE_INTERVAL_MAX} days`)
			.default(14),
		stockingDate: dateOnlySchema.nullish(),
		feedingRatePct: feedingRatePctSchema.optional(),
		...scheduleFields,
	})
	.strict();

const updatePondSchema = z
	.object({
		name: z
			.string("Pond name is required")
			.trim()
			.min(1, "Pond name is required")
			.max(POND_NAME_MAX, `Pond name cannot exceed ${POND_NAME_MAX} characters`),
		ownerFarmId: z.string().min(1, "Choose a farm owner"),
		population: populationSchema.nullish(),
		sampleIntervalDays: z
			.number("Sample interval must be a number")
			.int("Sample interval must be a whole number")
			.min(SAMPLE_INTERVAL_MIN, `Sample interval must be at least ${SAMPLE_INTERVAL_MIN} day`)
			.max(SAMPLE_INTERVAL_MAX, `Sample interval cannot exceed ${SAMPLE_INTERVAL_MAX} days`),
		feedingRatePct: feedingRatePctSchema,
		...scheduleFields,
	})
	.strict();

export type CreateTenantPondInput = z.input<typeof createPondSchema>;
export type UpdateTenantPondInput = z.input<typeof updatePondSchema> & { pondId: string };

export type PondActionResult = { success: true; pondId: string } | { error: string };
export type PondMutationResult = { success: true } | { error: string };
export type PondDeleteResult =
	| { success: true }
	| { error: string; code?: "step_up_required"; blockers?: PondDeletionBlockers };

export type PondOwnerOption = {
	/** `User.farmId`, which is what `Pond.ownerId` stores. */
	farmId: string;
	ownerName: string;
	farmName: string | null;
};

export type PondDeletionBlockers = {
	biomassLogs: number;
	feedEvents: number;
	cropCycles: number;
	devices: number;
	fcrReports: number;
	scheduleCommands: number;
	notifications: number;
	pondEvents: number;
};

export type PondDeletionCheck = {
	pondId: string;
	pondName: string;
	status: PondStatus;
	canDelete: boolean;
	blockers: PondDeletionBlockers;
};

function timeToDate(value: string): Date {
	const [hours, minutes] = value.split(":").map(Number);
	const date = new Date();
	date.setUTCHours(hours, minutes, 0, 0);
	return date;
}

function formatTime(date: Date): string {
	return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(
		2,
		"0",
	)}`;
}

function revalidatePondPaths(pondId?: string): void {
	revalidatePath("/[locale]/(admin)/admin/ponds", "page");
	revalidatePath("/[locale]/(admin)/admin/devices", "page");
	revalidatePath("/[locale]/(dashboard)/dashboard/settings/pond", "page");
	if (pondId) {
		revalidatePath("/[locale]/(admin)/admin/ponds/[pondId]", "page");
		revalidatePath("/[locale]/(admin)/admin/ponds/[pondId]/edit", "page");
		revalidatePath("/[locale]/(admin)/admin/ponds/[pondId]/delete", "page");
	}
}

/**
 * Devices the caller may place on a pond: those already on an in-scope pond,
 * plus feeders that were unassigned by this organization. An unassigned unit
 * has no `pondId` marker, so its last organization is read from the
 * `device_unassigned` event we wrote when it was detached. Without this, an
 * unassigned feeder could only come back through the platform registry.
 */
function scopedDeviceWhere(orgId: string | null, pondIds: string[]): Prisma.EnergyDeviceWhereInput {
	const assigned: Prisma.EnergyDeviceWhereInput = { pondId: { in: pondIds } };
	if (!orgId) return assigned;
	return {
		OR: [
			assigned,
			{
				pondId: null,
				stateEvents: {
					some: {
						eventType: "device_unassigned",
						metadata: { path: ["orgId"], equals: orgId },
					},
				},
			},
		],
	};
}

async function tenantContext(): Promise<{
	actorId: string;
	orgId: string | null;
	scope: Awaited<ReturnType<typeof resolveOrgScope>>;
}> {
	await requireTenantAdmin();
	await requirePermission("manage_farms_ponds");
	return tenantScope();
}

/**
 * Resolve the actor and scope after the caller has already run the guards.
 * Mutations call the guards explicitly at their own top, which is what the
 * static server-action guard test requires.
 */
async function tenantScope(): Promise<{
	actorId: string;
	orgId: string | null;
	scope: Awaited<ReturnType<typeof resolveOrgScope>>;
}> {
	const [scope, actor] = await Promise.all([resolveOrgScope(), getCurrentUser()]);
	if (!actor) throw new Error("Not authenticated.");
	return { actorId: actor.id, orgId: scope.orgIds[0] ?? null, scope };
}

/**
 * Farms a member with `manage_farms_ponds` may place a pond on. The label shows
 * the owner's name because that is what the console lists, with the farm name
 * and slug as secondary context.
 */
export async function getPondOwnerOptions(): Promise<PondOwnerOption[]> {
	const { scope } = await tenantContext();
	if (scope.farmIds.length === 0) return [];

	const users = await prisma.user.findMany({
		where: { farmId: { in: scope.farmIds } },
		orderBy: { displayName: "asc" },
		select: {
			farmId: true,
			displayName: true,
			email: true,
			farm: { select: { name: true } },
		},
	});

	return users.map((user) => ({
		farmId: user.farmId,
		ownerName: user.displayName || user.email || user.farmId,
		farmName: user.farm?.name ?? null,
	}));
}

async function ownerForFarm(
	farmId: string,
): Promise<{ farmId: string; displayName: string | null } | null> {
	return prisma.user.findUnique({
		where: { farmId },
		select: { farmId: true, displayName: true },
	});
}

/**
 * Create a pond for an existing farm owner.
 *
 * When a stocking date is supplied, an active grow-out cycle (and its stocking
 * and planned-harvest calendar events) is created in the same transaction, so a
 * new pond with fish in it is not left without its cycle. Without a stocking
 * date the pond is created empty and the owner can start a cycle later.
 */
export async function createTenantPond(input: CreateTenantPondInput): Promise<PondActionResult> {
	await requireTenantAdmin();
	await requirePermission("manage_farms_ponds");
	const { actorId, orgId, scope } = await tenantScope();
	const parsed = createPondSchema.safeParse(input);
	if (!parsed.success) return { error: formatZodError(parsed.error) };
	const data = parsed.data;

	if (!scope.farmIds.includes(data.ownerFarmId)) {
		return { error: "That farm is outside your organization." };
	}

	const owner = await ownerForFarm(data.ownerFarmId);
	if (!owner) return { error: `User with farm ID "${data.ownerFarmId}" not found.` };

	if (data.stockingDate && (!data.population || data.population < 1)) {
		return { error: "Enter the population to start a cycle from the stocking date." };
	}
	if (data.stockingDate && daysBetween(data.stockingDate, todayDateOnly()) < -7) {
		return { error: "Stocking date cannot be more than 7 days in the future." };
	}

	let feedingRatePct: number;
	if (data.feedingRatePct === undefined) {
		const orgIdForSettings = scope.orgIds[0];
		feedingRatePct = orgIdForSettings
			? (await getOrgSettings(orgIdForSettings)).defaultFeedingRatePct
			: ORG_SETTINGS_DEFAULTS.defaultFeedingRatePct;
	} else {
		feedingRatePct = data.feedingRatePct;
	}

	try {
		const pond = await prisma.$transaction(async (tx) => {
			const farm = await tx.farm.upsert({
				where: { ownerId: owner.farmId },
				update: {},
				create: {
					ownerId: owner.farmId,
					name: `${owner.displayName || owner.farmId} Farm`,
				},
			});

			const created = await tx.pond.create({
				data: {
					name: data.name,
					ownerId: owner.farmId,
					farmId: farm.id,
					feedingRatePct,
					feedsPerDay: data.feedsPerDay,
					population: data.population ?? null,
					sampleIntervalDays: data.sampleIntervalDays,
					scheduleStart: timeToDate(data.scheduleStart),
					scheduleEnd: timeToDate(data.scheduleEnd),
				},
			});

			if (data.stockingDate) {
				const targetHarvestDate = addDays(data.stockingDate, DEFAULT_GROW_OUT_DAYS);
				const cycle = await tx.cropCycle.create({
					data: {
						pondId: created.id,
						farmId: farm.id,
						status: "ACTIVE",
						stockingDate: dateOnlyToUtcDate(data.stockingDate),
						stockingCount: data.population as number,
						growOutDays: DEFAULT_GROW_OUT_DAYS,
						targetHarvestDate: dateOnlyToUtcDate(targetHarvestDate),
						createdBy: actorId,
					},
				});

				await tx.pondEvent.createMany({
					data: [
						{
							pondId: created.id,
							cropCycleId: cycle.id,
							farmId: farm.id,
							type: "STOCKING",
							status: "DONE",
							title: "Stocking",
							startsAt: dateOnlyToUtcDate(data.stockingDate),
							allDay: true,
							source: "cycle",
							createdBy: actorId,
							completedBy: actorId,
							completedAt: new Date(),
						},
						{
							pondId: created.id,
							cropCycleId: cycle.id,
							farmId: farm.id,
							type: "HARVEST_PLANNED",
							status: "PLANNED",
							title: "Harvest planned",
							startsAt: dateOnlyToUtcDate(targetHarvestDate),
							allDay: true,
							source: "cycle",
							createdBy: actorId,
						},
					],
				});
			}

			await writePlatformAudit(tx, {
				actorUserId: actorId,
				action: "pond.create",
				targetType: "pond",
				targetId: created.id,
				orgId,
				reason: AUDIT_REASON,
				after: {
					name: created.name,
					ownerId: created.ownerId,
					farmId: created.farmId,
					feedingRatePct,
					feedsPerDay: created.feedsPerDay,
					population: created.population,
					sampleIntervalDays: created.sampleIntervalDays,
					stockingDate: data.stockingDate ?? null,
				},
			});

			return created;
		});

		revalidatePondPaths(pond.id);
		return { success: true, pondId: pond.id };
	} catch (error) {
		console.error("[ponds] createTenantPond error:", error);
		return { error: "Failed to create the pond." };
	}
}

/**
 * Update every editable pond field. Changing the owner moves the pond to that
 * owner's farm in the same transaction, mirroring `updatePondOwner` but with
 * the full edit surface and one audit row.
 */
export async function updateTenantPond(input: UpdateTenantPondInput): Promise<PondMutationResult> {
	await requireTenantAdmin();
	await requirePermission("manage_farms_ponds");
	const { actorId, orgId, scope } = await tenantScope();
	const { pondId, ...patch } = input;
	const parsed = updatePondSchema.safeParse(patch);
	if (!parsed.success) return { error: formatZodError(parsed.error) };
	const data = parsed.data;

	if (!scope.pondIds.includes(pondId)) {
		return { error: "That pond is outside your organization." };
	}
	if (!scope.farmIds.includes(data.ownerFarmId)) {
		return { error: "That farm is outside your organization." };
	}

	const owner = await ownerForFarm(data.ownerFarmId);
	if (!owner) return { error: `User with farm ID "${data.ownerFarmId}" not found.` };

	const before = await prisma.pond.findFirst({
		where: { id: pondId, ownerId: { in: scope.farmIds } },
		select: {
			id: true,
			name: true,
			ownerId: true,
			farmId: true,
			feedingRatePct: true,
			feedsPerDay: true,
			population: true,
			sampleIntervalDays: true,
			scheduleStart: true,
			scheduleEnd: true,
		},
	});
	if (!before) return { error: "That pond is outside your organization." };

	// Editing the schedule must reach the feeders on the pond, and it must obey
	// the same daily-cap and relay-time limits as the farmer's Settings page.
	const devices = await prisma.energyDevice.findMany({
		where: { pondId: before.id },
		select: {
			id: true,
			buttonFeedGrams: true,
			gramsPerFeeding: true,
			gramsPerSecond: true,
			hopperCapacityG: true,
			dailyCapG: true,
		},
	});
	const feedingLimits = await getFeedingLimits();
	for (const device of devices) {
		const dailyCapG = resolveDailyCapG({
			configuredCapG: device.dailyCapG,
			hopperCapacityG: device.hopperCapacityG,
			dailyCapFactor: feedingLimits.dailyCapFactor,
		});
		const scheduledDailyG = data.feedsPerDay * device.gramsPerFeeding;
		if (scheduledDailyG > dailyCapG) {
			return {
				error: `Schedule would dispense ${Math.round(scheduledDailyG)} g/day — over the ${Math.round(dailyCapG)} g/day limit. Lower feeds per day or the feed amount.`,
			};
		}
		if (
			device.gramsPerSecond > 0 &&
			device.gramsPerFeeding / device.gramsPerSecond > MAX_DISPENSE_MS / 1000
		) {
			return {
				error: `Feed amount of ${device.gramsPerFeeding} g would take more than ${MAX_DISPENSE_MS / 1000} s of relay time at ${device.gramsPerSecond} g/s. Add more meals per day or reduce the feed amount.`,
			};
		}
	}

	try {
		await prisma.$transaction(async (tx) => {
			const farm = await tx.farm.upsert({
				where: { ownerId: owner.farmId },
				update: {},
				create: {
					ownerId: owner.farmId,
					name: `${owner.displayName || owner.farmId} Farm`,
				},
			});

			const updated = await tx.pond.update({
				where: { id: before.id },
				data: {
					name: data.name,
					ownerId: owner.farmId,
					farmId: farm.id,
					feedingRatePct: data.feedingRatePct,
					feedsPerDay: data.feedsPerDay,
					population: data.population ?? null,
					sampleIntervalDays: data.sampleIntervalDays,
					scheduleStart: timeToDate(data.scheduleStart),
					scheduleEnd: timeToDate(data.scheduleEnd),
				},
			});

			// Queue the new schedule for every feeder on the pond; the device poll
			// picks it up and acks it through the normal command path.
			for (const device of devices) {
				const command = await tx.scheduleCommand.create({
					data: {
						deviceId: device.id,
						pondId: updated.id,
						scheduleStart: timeToDate(data.scheduleStart),
						scheduleEnd: timeToDate(data.scheduleEnd),
						feedsPerDay: data.feedsPerDay,
						feedingRatePct: data.feedingRatePct,
						buttonFeedGrams: device.buttonFeedGrams,
						status: "pending",
						createdBy: actorId,
						farmId: updated.farmId,
					},
				});
				await tx.deviceStateEvent.create({
					data: {
						deviceId: device.id,
						eventType: "schedule_changed",
						source: "user",
						actorId,
						farmId: updated.farmId,
						metadata: {
							commandId: command.id,
							scheduleStart: data.scheduleStart,
							scheduleEnd: data.scheduleEnd,
							feedsPerDay: data.feedsPerDay,
							feedingRatePct: data.feedingRatePct,
						},
					},
				});
			}

			await writePlatformAudit(tx, {
				actorUserId: actorId,
				action: "pond.update",
				targetType: "pond",
				targetId: updated.id,
				orgId,
				reason: AUDIT_REASON,
				before: {
					name: before.name,
					ownerId: before.ownerId,
					farmId: before.farmId,
					feedingRatePct: before.feedingRatePct,
					feedsPerDay: before.feedsPerDay,
					population: before.population,
					sampleIntervalDays: before.sampleIntervalDays,
					scheduleStart: formatTime(before.scheduleStart),
					scheduleEnd: formatTime(before.scheduleEnd),
				},
				after: {
					name: updated.name,
					ownerId: updated.ownerId,
					farmId: updated.farmId,
					feedingRatePct: updated.feedingRatePct,
					feedsPerDay: updated.feedsPerDay,
					population: updated.population,
					sampleIntervalDays: updated.sampleIntervalDays,
					scheduleStart: data.scheduleStart,
					scheduleEnd: data.scheduleEnd,
				},
			});
		});

		// Keep the device's dispensed grams in sync with the new rate/population.
		// A failure here must not report the committed pond edit as failed.
		try {
			await syncDeviceGramsForPond(before.id, {
				feedingRatePct: data.feedingRatePct,
				feedsPerDay: data.feedsPerDay,
				population: data.population ?? null,
			});
		} catch (syncError) {
			console.error("[ponds] syncDeviceGramsForPond error:", syncError);
		}

		revalidatePondPaths(before.id);
		return { success: true };
	} catch (error) {
		console.error("[ponds] updateTenantPond error:", error);
		return { error: "Failed to update the pond." };
	}
}

/**
 * Everything the detail page needs, scoped to the caller's organization.
 *
 * Only the active cycle and the newest biomass/FCR rows are read; the page is a
 * summary, not a report. Pending and rejected devices are included on purpose so
 * their approval status is visible next to the pond they were registered for.
 */
export async function getPondDetail(pondId: string) {
	await requireTenantAdmin();
	const scope = await resolveOrgScope();
	if (typeof pondId !== "string" || !scope.pondIds.includes(pondId)) return null;

	const pond = await prisma.pond.findFirst({
		where: { id: pondId, ownerId: { in: scope.farmIds } },
		include: {
			owner: { select: { displayName: true, farmId: true, email: true } },
			farm: { select: { id: true, name: true, ownerId: true } },
			energyDevices: {
				orderBy: { createdAt: "asc" },
				select: {
					id: true,
					label: true,
					mac: true,
					lastSeenAt: true,
					feedLevelPercent: true,
					feedLevelUpdatedAt: true,
					approvalStatus: true,
					gramsPerFeeding: true,
					dailyCapG: true,
					createdAt: true,
				},
			},
			cropCycles: {
				where: { status: "ACTIVE" },
				orderBy: { createdAt: "desc" },
				take: 1,
			},
			biomassLogs: {
				orderBy: { recordedAt: "desc" },
				take: 1,
				select: {
					id: true,
					sampleWeightKg: true,
					sampleCount: true,
					avgWeightKg: true,
					recordedAt: true,
				},
			},
			fcrReports: {
				orderBy: { periodEnd: "desc" },
				take: 1,
				select: {
					id: true,
					fcrValue: true,
					periodStart: true,
					periodEnd: true,
					totalFeedKg: true,
					biomassGainKg: true,
				},
			},
			ownershipHistory: {
				orderBy: { createdAt: "desc" },
				take: 10,
				select: {
					id: true,
					eventType: true,
					farmId: true,
					previousFarmId: true,
					changedById: true,
					createdAt: true,
				},
			},
			_count: {
				select: {
					biomassLogs: true,
					fcrReports: true,
					cropCycles: true,
					pondEvents: true,
					energyDevices: true,
					scheduleCommands: true,
				},
			},
		},
	});

	if (!pond) return null;

	const otherPondIds = scope.pondIds.filter((id) => id !== pondId);
	const [movableDevices, feedEventCount] = await Promise.all([
		prisma.energyDevice.findMany({
			where: scopedDeviceWhere(scope.orgIds[0] ?? null, otherPondIds),
			orderBy: { createdAt: "asc" },
			select: {
				id: true,
				label: true,
				mac: true,
				pond: { select: { id: true, name: true } },
			},
		}),
		prisma.feedEvent.count({ where: { device: { pondId } } }),
	]);

	return { pond, movableDevices, feedEventCount };
}

type PondDetail = NonNullable<Awaited<ReturnType<typeof getPondDetail>>>;

async function blockersFor(
	client: Prisma.TransactionClient,
	pondId: string,
): Promise<PondDeletionBlockers> {
	const [
		biomassLogs,
		feedEvents,
		cropCycles,
		energyDevices,
		legacyDevices,
		fcrReports,
		scheduleCommands,
		notifications,
		pondEvents,
	] = await Promise.all([
		client.biomassLog.count({ where: { pondId } }),
		client.feedEvent.count({ where: { device: { pondId } } }),
		client.cropCycle.count({ where: { pondId } }),
		client.energyDevice.count({ where: { pondId } }),
		// The deprecated `Device` table still has rows on older ponds and its
		// pond relation has no cascade, so a delete would fail on the foreign
		// key. Count it as hardware: the pond is archived, not deleted.
		client.device.count({ where: { pondId } }),
		client.fcrReport.count({ where: { pondId } }),
		client.scheduleCommand.count({ where: { pondId } }),
		client.notification.count({ where: { pondId } }),
		client.pondEvent.count({ where: { pondId } }),
	]);

	return {
		biomassLogs,
		feedEvents,
		cropCycles,
		devices: energyDevices + legacyDevices,
		fcrReports,
		scheduleCommands,
		notifications,
		pondEvents,
	};
}

/** True when every blocker count is zero. */
function hasNoPondHistory(blockers: PondDeletionBlockers): boolean {
	return Object.values(blockers).every((count) => count === 0);
}

/**
 * What the delete page shows before the admin commits: the pond name and every
 * reason the pond cannot be deleted. Returns null outside the caller's org.
 */
export async function getPondDeletionCheck(pondId: string): Promise<PondDeletionCheck | null> {
	const { scope } = await tenantContext();
	if (typeof pondId !== "string" || !scope.pondIds.includes(pondId)) return null;

	const pond = await prisma.pond.findFirst({
		where: { id: pondId, ownerId: { in: scope.farmIds } },
		select: { id: true, name: true, status: true },
	});
	if (!pond) return null;

	const blockers = await blockersFor(prisma as unknown as Prisma.TransactionClient, pond.id);
	return {
		pondId: pond.id,
		pondName: pond.name,
		status: pond.status,
		canDelete: hasNoPondHistory(blockers),
		blockers,
	};
}

/**
 * Permanently delete an empty pond.
 *
 * Requires the typed pond name and a fresh step-up. Any biomass sample, feed
 * event, cycle, device or other history keeps the pond alive; the caller is
 * told to archive instead. Blockers are re-read inside the transaction so a
 * sample arriving between the page load and the click still stops the delete.
 */
export async function deleteTenantPond(input: {
	pondId: string;
	confirmName: string;
}): Promise<PondDeleteResult> {
	await requireTenantAdmin();
	await requirePermission("manage_farms_ponds");
	const { actorId, orgId, scope } = await tenantScope();
	if (typeof input?.pondId !== "string" || !scope.pondIds.includes(input.pondId)) {
		return { error: "That pond is outside your organization." };
	}

	const pond = await prisma.pond.findFirst({
		where: { id: input.pondId, ownerId: { in: scope.farmIds } },
		select: { id: true, name: true, ownerId: true, farmId: true },
	});
	if (!pond) return { error: "That pond is outside your organization." };

	if ((input.confirmName ?? "").trim() !== pond.name) {
		return { error: "Type the pond name exactly to confirm deletion." };
	}

	const initialBlockers = await blockersFor(prisma as unknown as Prisma.TransactionClient, pond.id);
	if (!hasNoPondHistory(initialBlockers)) {
		return {
			error: "This pond has data or devices. Archive it instead.",
			blockers: initialBlockers,
		};
	}

	try {
		await withStepUp(async (stepUpAt) => {
			await prisma.$transaction(async (tx) => {
				const blockers = await blockersFor(tx, pond.id);
				if (!hasNoPondHistory(blockers)) {
					throw new Error("POND_HAS_HISTORY");
				}

				await writePlatformAudit(tx, {
					actorUserId: actorId,
					action: "pond.delete",
					targetType: "pond",
					targetId: pond.id,
					orgId,
					reason: AUDIT_REASON,
					stepUpAt,
					before: {
						name: pond.name,
						ownerId: pond.ownerId,
						farmId: pond.farmId,
					},
				});

				await tx.pond.delete({ where: { id: pond.id } });
			});
		});

		revalidatePondPaths(pond.id);
		return { success: true };
	} catch (error) {
		if (isStepUpRequiredError(error)) {
			return { error: error.message, code: "step_up_required" };
		}
		if (error instanceof Error && error.message === "POND_HAS_HISTORY") {
			return { error: "This pond has data or devices. Archive it instead." };
		}
		console.error("[ponds] deleteTenantPond error:", error);
		return { error: "Failed to delete the pond." };
	}
}

/**
 * Move a feeder between two ponds of the same organization.
 *
 * The device must currently sit on a pond in scope; an unassigned device has no
 * tenant marker and is therefore not movable through this action. The target
 * pond must be in scope too, so a cross-org move is refused on both ends.
 */
export async function moveDeviceToPond(input: {
	deviceId: string;
	targetPondId: string;
}): Promise<PondMutationResult> {
	await requireTenantAdmin();
	await requirePermission("manage_farms_ponds");
	const { actorId, orgId, scope } = await tenantScope();
	if (typeof input?.deviceId !== "string" || typeof input.targetPondId !== "string") {
		return { error: "Choose a device and a pond." };
	}
	if (!scope.pondIds.includes(input.targetPondId)) {
		return { error: "That pond is outside your organization." };
	}

	const device = await prisma.energyDevice.findFirst({
		where: {
			id: input.deviceId,
			...scopedDeviceWhere(orgId, scope.pondIds),
		},
		select: {
			id: true,
			label: true,
			pondId: true,
			pond: { select: { ownerId: true, name: true } },
		},
	});
	if (!device) return { error: "Device not found in your organization." };
	if (device.pondId === input.targetPondId) {
		return { error: "That device is already on this pond." };
	}

	const target = await prisma.pond.findFirst({
		where: { id: input.targetPondId, ownerId: { in: scope.farmIds } },
		select: { id: true, name: true, ownerId: true },
	});
	if (!target) return { error: "That pond is outside your organization." };

	try {
		await prisma.$transaction(async (tx) => {
			await tx.energyDevice.update({
				where: { id: device.id },
				data: { pondId: target.id },
			});

			await tx.deviceStateEvent.create({
				data: {
					deviceId: device.id,
					eventType: "device_moved",
					source: "user",
					actorId,
					farmId: target.ownerId,
					metadata: {
						orgId,
						fromPondId: device.pondId,
						fromPondName: device.pond?.name ?? null,
						toPondId: target.id,
						toPondName: target.name,
					},
				},
			});

			await writePlatformAudit(tx, {
				actorUserId: actorId,
				action: "pond.device.move",
				targetType: "energy_device",
				targetId: device.id,
				orgId,
				reason: AUDIT_REASON,
				before: { pondId: device.pondId, pondName: device.pond?.name ?? null },
				after: { pondId: target.id, pondName: target.name },
			});
		});

		revalidatePondPaths(device.pondId ?? undefined);
		revalidatePondPaths(target.id);
		return { success: true };
	} catch (error) {
		console.error("[ponds] moveDeviceToPond error:", error);
		return { error: "Failed to move the device." };
	}
}

/**
 * Detach a device from its pond. A pond-less device receives no schedule, so
 * the UI explains that before calling this.
 */
export async function unassignDevice(deviceId: string): Promise<PondMutationResult> {
	await requireTenantAdmin();
	await requirePermission("manage_farms_ponds");
	const { actorId, orgId, scope } = await tenantScope();
	if (typeof deviceId !== "string" || !deviceId) {
		return { error: "Choose a device." };
	}

	const device = await prisma.energyDevice.findFirst({
		where: { id: deviceId, pondId: { in: scope.pondIds } },
		select: {
			id: true,
			label: true,
			pondId: true,
			pond: { select: { ownerId: true, name: true } },
		},
	});
	if (!device) return { error: "Device not found in your organization." };

	try {
		await prisma.$transaction(async (tx) => {
			await tx.energyDevice.update({
				where: { id: device.id },
				data: { pondId: null },
			});

			await tx.deviceStateEvent.create({
				data: {
					deviceId: device.id,
					eventType: "device_unassigned",
					source: "user",
					actorId,
					farmId: device.pond?.ownerId ?? null,
					metadata: {
						orgId,
						fromPondId: device.pondId,
						fromPondName: device.pond?.name ?? null,
					},
				},
			});

			await writePlatformAudit(tx, {
				actorUserId: actorId,
				action: "pond.device.unassign",
				targetType: "energy_device",
				targetId: device.id,
				orgId,
				reason: AUDIT_REASON,
				before: { pondId: device.pondId, pondName: device.pond?.name ?? null },
				after: { pondId: null },
			});
		});

		revalidatePondPaths(device.pondId ?? undefined);
		return { success: true };
	} catch (error) {
		console.error("[ponds] unassignDevice error:", error);
		return { error: "Failed to unassign the device." };
	}
}
