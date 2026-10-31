"use server";

import { actorContext, writePlatformAudit } from "@/lib/actions/platform/audit";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { isStepUpRequiredError, withStepUp } from "@/lib/auth/step-up";
import { parseDeviceLabelIds } from "@/lib/device-label-selection";
import {
	DUPLICATE_MAC_MESSAGE,
	createDeviceCredentials,
	validateDeviceRegistration,
} from "@/lib/device-registration";
import { createManualFeedRequest, setSchedulePause } from "@/lib/feed/commands";
import { resolvePagination } from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { checkDeviceTokenRevealRateLimit } from "@/lib/rate-limit";
import { getListPageSize } from "@/lib/settings/platform";
import { Prisma } from "@prisma/client";

/**
 * Platform device registry (plan v2, phase M3F, M5.2).
 *
 * Registering hardware is inventory work; remote feeder control is god mode
 * (decision D1) and goes through the same command implementation the tenant
 * dashboard uses (lib/feed/commands.ts), so the §6 server caps apply to both
 * and there is no "force" flag. Every export is gated by
 * requirePlatformAdmin(), and every mutation requires a reason, a fresh
 * step-up and writes exactly one PlatformAuditLog row in the same transaction.
 *
 * Device tokens: a new token is returned to the caller exactly once in the
 * action result. Because of plan decision T16 the plaintext is still stored in
 * EnergyDevice.token (the tenant "Show token" reveal needs it) until M4.3. The
 * token never appears in an audit row, a log line or a page payload.
 */

const MIN_REASON_LENGTH = 10;
const MAX_LABEL_LENGTH = 64;
const MAX_LABELS = 40;

function requireReason(reason: string | undefined): string {
	const trimmed = reason?.trim() ?? "";
	if (trimmed.length < MIN_REASON_LENGTH) {
		throw new Error(`A reason of at least ${MIN_REASON_LENGTH} characters is required.`);
	}
	return trimmed;
}

/** One energy-device audit row (targetType is always energy_device). */
async function auditDevice(
	data: {
		action: string;
		deviceId: string;
		orgId: string | null;
		reason: string;
		actorUserId: string;
		temporaryGrant: boolean;
		stepUpAt: Date;
		before?: Prisma.InputJsonValue;
		after?: Prisma.InputJsonValue;
	},
	tx: Prisma.TransactionClient,
): Promise<void> {
	await writePlatformAudit(tx, {
		actorUserId: data.actorUserId,
		action: data.action,
		targetType: "energy_device",
		targetId: data.deviceId,
		orgId: data.orgId,
		reason: data.reason,
		stepUpAt: data.stepUpAt,
		temporaryGrant: data.temporaryGrant,
		...(data.before !== undefined ? { before: data.before } : {}),
		...(data.after !== undefined ? { after: data.after } : {}),
	});
}

/**
 * Orgs a device on `pond` belongs to, resolved the same way as resolveOrgScope:
 * pond owner farm → user → active memberships of an ACTIVE org.
 */
async function orgsForFarms(
	farmIds: string[],
): Promise<Map<string, { id: string; name: string }[]>> {
	const result = new Map<string, { id: string; name: string }[]>();
	if (farmIds.length === 0) return result;

	const users = await prisma.user.findMany({
		where: { farmId: { in: farmIds } },
		select: { id: true, farmId: true },
	});
	const memberships = users.length
		? await prisma.membership.findMany({
				where: { userId: { in: users.map((u) => u.id) }, revokedAt: null },
				select: { userId: true, orgId: true },
			})
		: [];
	const orgs = memberships.length
		? await prisma.organization.findMany({
				where: { id: { in: [...new Set(memberships.map((m) => m.orgId))] } },
				select: { id: true, name: true },
			})
		: [];

	const orgById = new Map(orgs.map((o) => [o.id, o]));
	const farmByUser = new Map(users.map((u) => [u.id, u.farmId]));
	for (const m of memberships) {
		const farmId = farmByUser.get(m.userId);
		const org = orgById.get(m.orgId);
		if (!farmId || !org) continue;
		const list = result.get(farmId) ?? [];
		if (!list.some((o) => o.id === org.id)) list.push(org);
		result.set(farmId, list);
	}
	return result;
}

// ─── Registry list ────────────────────────────────────────────────────────────

export type PlatformDeviceRow = {
	id: string;
	label: string;
	mac: string;
	lastSeenAt: Date | null;
	createdAt: Date;
	isPaused: boolean;
	pond: { id: string; name: string } | null;
	orgs: { id: string; name: string }[];
};

export type PlatformDevicePage = {
	rows: PlatformDeviceRow[];
	total: number;
	page: number;
	pageSize: number;
};

/**
 * Every device on the platform, including legacy rows with no pond, newest
 * first, paginated and searchable by MAC or label. Display fields only:
 * token and tokenHash are never selected.
 */
export async function listPlatformDevices(
	input: { query?: string; page?: number } = {},
): Promise<PlatformDevicePage> {
	await requirePlatformAdmin();

	const query = input.query?.trim().slice(0, 64) ?? "";
	const page = Math.max(1, Math.floor(input.page ?? 1) || 1);
	const pageSize = await getListPageSize();
	const where: Prisma.EnergyDeviceWhereInput = query
		? {
				OR: [
					{ mac: { contains: query, mode: "insensitive" } },
					{ label: { contains: query, mode: "insensitive" } },
				],
			}
		: {};

	const [total, devicesResult] = await Promise.all([
		prisma.energyDevice.count({ where }),
		prisma.energyDevice.findMany({
			where,
			orderBy: { createdAt: "desc" },
			skip: (page - 1) * pageSize,
			take: pageSize,
			select: {
				id: true,
				label: true,
				mac: true,
				lastSeenAt: true,
				createdAt: true,
				isPaused: true,
				pond: { select: { id: true, name: true, ownerId: true } },
			},
		}),
	]);
	const paging = resolvePagination(page, pageSize, total);
	let devices = devicesResult;
	if (paging.page !== page) {
		devices = await prisma.energyDevice.findMany({
			where,
			orderBy: { createdAt: "desc" },
			skip: paging.offset,
			take: paging.pageSize,
			select: {
				id: true,
				label: true,
				mac: true,
				lastSeenAt: true,
				createdAt: true,
				isPaused: true,
				pond: { select: { id: true, name: true, ownerId: true } },
			},
		});
	}

	const orgsByFarm = await orgsForFarms([
		...new Set(devices.flatMap((d) => (d.pond ? [d.pond.ownerId] : []))),
	]);

	return {
		rows: devices.map((d) => ({
			id: d.id,
			label: d.label,
			mac: d.mac,
			lastSeenAt: d.lastSeenAt,
			createdAt: d.createdAt,
			isPaused: d.isPaused,
			pond: d.pond ? { id: d.pond.id, name: d.pond.name } : null,
			orgs: d.pond ? (orgsByFarm.get(d.pond.ownerId) ?? []) : [],
		})),
		total,
		page: paging.page,
		pageSize: paging.pageSize,
	};
}

// ─── Assignment options ───────────────────────────────────────────────────────

export type OrgPondOption = {
	orgId: string;
	orgName: string;
	ponds: { id: string; name: string; ownerFarmId: string; deviceCount: number }[];
};

/**
 * ACTIVE orgs and the ponds a new device may be assigned to: the ponds owned
 * by the org's active members (same chain as resolveOrgScope).
 */
export async function getOrgPondOptions(): Promise<OrgPondOption[]> {
	await requirePlatformAdmin();

	const orgs = await prisma.organization.findMany({
		where: { status: "ACTIVE" },
		orderBy: { name: "asc" },
		select: { id: true, name: true },
	});
	if (orgs.length === 0) return [];

	const memberships = await prisma.membership.findMany({
		where: { orgId: { in: orgs.map((o) => o.id) }, revokedAt: null },
		select: { orgId: true, userId: true },
	});
	const users = memberships.length
		? await prisma.user.findMany({
				where: { id: { in: [...new Set(memberships.map((m) => m.userId))] } },
				select: { id: true, farmId: true },
			})
		: [];
	const farmByUser = new Map(users.map((u) => [u.id, u.farmId]));
	const ponds = users.length
		? await prisma.pond.findMany({
				where: { ownerId: { in: users.map((u) => u.farmId) } },
				orderBy: { name: "asc" },
				select: {
					id: true,
					name: true,
					ownerId: true,
					_count: { select: { energyDevices: true } },
				},
			})
		: [];

	return orgs.map((org) => {
		const farmIds = new Set(
			memberships
				.filter((m) => m.orgId === org.id)
				.map((m) => farmByUser.get(m.userId))
				.filter((f): f is string => Boolean(f)),
		);
		return {
			orgId: org.id,
			orgName: org.name,
			ponds: ponds
				.filter((p) => farmIds.has(p.ownerId))
				.map((p) => ({
					id: p.id,
					name: p.name,
					ownerFarmId: p.ownerId,
					deviceCount: p._count.energyDevices,
				})),
		};
	});
}

// ─── Register ─────────────────────────────────────────────────────────────────

export type StepUpRequiredResult = { error: string; code: "step_up_required" };
export type RateLimitedResult = { error: string; code: "rate_limited" };

export type RegisterDeviceResult =
	| { success: true; deviceId: string; mac: string; token: string }
	| StepUpRequiredResult
	| { error: string; code?: undefined };

/**
 * Register a new device on a pond of an ACTIVE org (plan T15).
 *
 * The MAC must be the chip's eFuse MAC (the boot log's [DEVICE MAC] line), so
 * the setup AP name and the printed sticker match. The org/pond pairing is
 * re-checked on the server; the client's options are never trusted.
 */
export async function registerDevice(input: {
	mac: string;
	label: string;
	orgId: string;
	pondId: string;
	reason: string;
}): Promise<RegisterDeviceResult> {
	await requirePlatformAdmin();

	let reason: string;
	try {
		reason = requireReason(input.reason);
	} catch (e) {
		return { error: e instanceof Error ? e.message : "A reason is required." };
	}

	const registration = validateDeviceRegistration({ mac: input.mac, label: input.label });
	if (!registration.ok) return { error: registration.error };
	const { mac, label } = registration;

	if (typeof input.orgId !== "string" || typeof input.pondId !== "string") {
		return { error: "Choose an organization and a pond." };
	}

	try {
		const org = await prisma.organization.findFirst({
			where: { id: input.orgId, status: "ACTIVE" },
			select: { id: true },
		});
		if (!org) return { error: "Choose an active organization." };

		const memberUserIds = (
			await prisma.membership.findMany({
				where: { orgId: org.id, revokedAt: null },
				select: { userId: true },
			})
		).map((m) => m.userId);
		const farmIds = memberUserIds.length
			? (
					await prisma.user.findMany({
						where: { id: { in: memberUserIds } },
						select: { farmId: true },
					})
				).map((u) => u.farmId)
			: [];
		const pond = farmIds.length
			? await prisma.pond.findFirst({
					where: { id: input.pondId, ownerId: { in: farmIds } },
					select: { id: true },
				})
			: null;
		if (!pond) return { error: "That pond does not belong to the chosen organization." };

		// The column is case-sensitive; legacy rows may not be canonical.
		const existing = await prisma.energyDevice.findFirst({
			where: { mac: { equals: mac, mode: "insensitive" } },
			select: { id: true },
		});
		if (existing) return { error: DUPLICATE_MAC_MESSAGE };

		const actor = await actorContext();

		// Registering hardware with a live credential is a device action: fresh
		// password re-entry is required (plan §4.4), and the audit row records it.
		const { deviceId, token } = await withStepUp(async (stepUpAt) => {
			const credentials = createDeviceCredentials();
			const id = await prisma.$transaction(async (tx) => {
				const device = await tx.energyDevice.create({
					data: {
						mac,
						label,
						pondId: pond.id,
						token: credentials.token,
						tokenHash: credentials.tokenHash,
						// The platform registry always creates approved units; the
						// tenant approval policy applies to the tenant flow only.
						approvalStatus: "APPROVED",
					},
					select: { id: true },
				});
				await auditDevice(
					{
						action: "platform.device.create",
						deviceId: device.id,
						orgId: org.id,
						reason,
						actorUserId: actor.id,
						temporaryGrant: actor.temporaryGrant,
						stepUpAt,
						after: { mac, label, pondId: pond.id },
					},
					tx,
				);
				return device.id;
			});
			return { deviceId: id, token: credentials.token };
		});

		return { success: true, deviceId, mac, token };
	} catch (e) {
		if (isStepUpRequiredError(e)) {
			return { error: e.message, code: "step_up_required" };
		}
		if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
			return { error: DUPLICATE_MAC_MESSAGE };
		}
		console.error(
			"[platform] registerDevice error:",
			e instanceof Error ? e.message : "unknown error",
		);
		return { error: "Failed to register the device." };
	}
}

// ─── Rotate token ─────────────────────────────────────────────────────────────

export type RotateDeviceTokenResult =
	| { success: true; token: string }
	| StepUpRequiredResult
	| RateLimitedResult
	| { error: string; code?: undefined };

/**
 * Issue a new token for a device. The old token stops authenticating at once,
 * because device auth looks tokens up by hash. The unit keeps failing until
 * the new token is set on it through the setup portal.
 *
 * Rotation mints a fresh long-lived credential, so it draws from the same
 * per-actor reveal allowance as the tenant "Show token" path: a stolen platform
 * session cannot loop over the registry draining one token per device.
 */
export async function rotateDeviceToken(input: {
	deviceId: string;
	reason: string;
}): Promise<RotateDeviceTokenResult> {
	await requirePlatformAdmin();

	let reason: string;
	try {
		reason = requireReason(input.reason);
	} catch (e) {
		return { error: e instanceof Error ? e.message : "A reason is required." };
	}
	if (typeof input.deviceId !== "string" || !input.deviceId) {
		return { error: "A device is required." };
	}

	try {
		const actor = await actorContext();

		// Same bucket and window as revealDeviceToken (issue #331): the actor is
		// the key, so a rotation cannot rotate device ids to buy a new allowance.
		const limit = await checkDeviceTokenRevealRateLimit(actor.id);
		if (!limit.success) {
			return {
				error: "Too many token reveals. Try again in an hour.",
				code: "rate_limited",
			};
		}

		const device = await prisma.energyDevice.findUnique({
			where: { id: input.deviceId },
			select: { id: true, mac: true, pond: { select: { ownerId: true } } },
		});
		if (!device) return { error: "Device not found." };

		const orgs = device.pond ? await orgsForFarms([device.pond.ownerId]) : new Map();
		const orgId = device.pond ? (orgs.get(device.pond.ownerId)?.[0]?.id ?? null) : null;

		// A rotation invalidates the unit's working credential, so it needs a
		// fresh step-up just like registration.
		const token = await withStepUp(async (stepUpAt) => {
			const credentials = createDeviceCredentials();
			await prisma.$transaction(async (tx) => {
				await tx.energyDevice.update({
					where: { id: device.id },
					data: { token: credentials.token, tokenHash: credentials.tokenHash },
				});
				await auditDevice(
					{
						action: "platform.device.rotate_token",
						deviceId: device.id,
						orgId,
						reason,
						actorUserId: actor.id,
						temporaryGrant: actor.temporaryGrant,
						stepUpAt,
						after: { mac: device.mac },
					},
					tx,
				);
			});
			return credentials.token;
		});

		return { success: true, token };
	} catch (e) {
		if (isStepUpRequiredError(e)) {
			return { error: e.message, code: "step_up_required" };
		}
		console.error(
			"[platform] rotateDeviceToken error:",
			e instanceof Error ? e.message : "unknown error",
		);
		return { error: "Failed to rotate the token." };
	}
}

// ─── Sticker data ─────────────────────────────────────────────────────────────

export type PlatformDeviceLabelRow = { id: string; label: string; mac: string };

/**
 * Display fields for the printable sticker, for any device on the platform.
 * Allow-listed select: token and tokenHash are never read.
 *
 * An empty selection means "every device on the platform" (the Superadmin
 * → Devices print-selected form submits no ids when nothing is ticked),
 * newest first and bounded by MAX_LABELS.
 */
export async function getPlatformDevicesForLabels(
	deviceIds: string[],
): Promise<PlatformDeviceLabelRow[]> {
	await requirePlatformAdmin();

	const ids = parseDeviceLabelIds(deviceIds).slice(0, MAX_LABELS);
	if (ids.length === 0) {
		return prisma.energyDevice.findMany({
			select: { id: true, label: true, mac: true },
			orderBy: [{ createdAt: "desc" }, { id: "asc" }],
			take: MAX_LABELS,
		});
	}

	const devices = await prisma.energyDevice.findMany({
		where: { id: { in: ids } },
		select: { id: true, label: true, mac: true },
	});
	const order = new Map(ids.map((id, index) => [id, index]));
	return devices.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

// ─── Remote feeder control (M5.2, decision D1) ───────────────────────────────

export type RemoteFeedResult =
	| { success: true; message?: string }
	| StepUpRequiredResult
	| { success: false; code: "feed_refused"; error: string }
	| { error: string; code?: undefined };

export type RemotePauseResult =
	| { success: true; isPaused: boolean }
	| StepUpRequiredResult
	| { success: false; code: "pause_refused"; error: string }
	| { error: string; code?: undefined };

const NO_DEVICE_MESSAGE = "Device not found.";

/**
 * Feed any feeder on the platform (god mode, decision D1).
 *
 * This is the same command the tenant dashboard issues: the daily ceiling (the
 * only gram cap), the relay-time and offline checks are enforced inside
 * lib/feed/commands.ts. There is deliberately no force/burst parameter, so a
 * remote command to an empty hopper or an offline unit is refused by the same
 * rules as a local one. A refusal is audited and returned as `feed_refused`.
 */
export async function remoteFeedDevice(input: {
	deviceId: string;
	grams: number;
	reason: string;
}): Promise<RemoteFeedResult> {
	await requirePlatformAdmin();

	let reason: string;
	try {
		reason = requireReason(input.reason);
	} catch (e) {
		return { error: e instanceof Error ? e.message : "A reason is required." };
	}
	if (typeof input.deviceId !== "string" || !input.deviceId) {
		return { error: "A device is required." };
	}
	if (typeof input.grams !== "number" || !Number.isFinite(input.grams)) {
		return { error: "Enter the feed amount in grams." };
	}

	try {
		const device = await prisma.energyDevice.findUnique({
			where: { id: input.deviceId },
			select: { id: true, pond: { select: { ownerId: true } } },
		});
		if (!device) return { error: NO_DEVICE_MESSAGE };

		const orgId = await orgIdForDevice(device.pond?.ownerId ?? null);
		const actor = await actorContext();

		return await withStepUp(async (stepUpAt) => {
			return prisma.$transaction(async (tx) => {
				const outcome = await createManualFeedRequest(tx, {
					deviceId: device.id,
					grams: input.grams,
					actorId: actor.id,
					triggerSource: "platform_remote",
				});

				if (!outcome.ok) {
					await auditDevice(
						{
							action: "platform.device.feed_refused",
							deviceId: device.id,
							orgId,
							reason,
							actorUserId: actor.id,
							temporaryGrant: actor.temporaryGrant,
							stepUpAt,
							after: { grams: input.grams, code: outcome.code, error: outcome.error },
						},
						tx,
					);
					return { success: false as const, code: "feed_refused" as const, error: outcome.error };
				}

				await auditDevice(
					{
						action: "platform.device.feed",
						deviceId: device.id,
						orgId,
						reason,
						actorUserId: actor.id,
						temporaryGrant: actor.temporaryGrant,
						stepUpAt,
						after: {
							grams: input.grams,
							requestId: outcome.requestId,
							alreadyPending: outcome.alreadyPending,
						},
					},
					tx,
				);

				return outcome.alreadyPending
					? { success: true as const, message: "Feed already pending" }
					: { success: true as const };
			});
		});
	} catch (e) {
		if (isStepUpRequiredError(e)) {
			return { error: e.message, code: "step_up_required" };
		}
		console.error(
			"[platform] remoteFeedDevice error:",
			e instanceof Error ? e.message : "unknown error",
		);
		return { error: "Failed to send the feed command." };
	}
}

/**
 * Pause or resume any feeder's schedule (god mode, decision D1).
 *
 * Uses the same device write and DeviceStateEvent as the dashboard toggle.
 * Resuming a fallow pond is refused, exactly as it is locally.
 */
export async function remoteSetDevicePause(input: {
	deviceId: string;
	isPaused: boolean;
	reason: string;
}): Promise<RemotePauseResult> {
	await requirePlatformAdmin();

	let reason: string;
	try {
		reason = requireReason(input.reason);
	} catch (e) {
		return { error: e instanceof Error ? e.message : "A reason is required." };
	}
	if (typeof input.deviceId !== "string" || !input.deviceId) {
		return { error: "A device is required." };
	}
	if (typeof input.isPaused !== "boolean") {
		return { error: "Choose pause or resume." };
	}

	try {
		const device = await prisma.energyDevice.findUnique({
			where: { id: input.deviceId },
			select: { id: true, isPaused: true, pond: { select: { ownerId: true } } },
		});
		if (!device) return { error: NO_DEVICE_MESSAGE };

		const orgId = await orgIdForDevice(device.pond?.ownerId ?? null);
		const actor = await actorContext();

		return await withStepUp(async (stepUpAt) => {
			return prisma.$transaction(async (tx) => {
				const outcome = await setSchedulePause(tx, {
					deviceId: device.id,
					isPaused: input.isPaused,
					actorId: actor.id,
				});

				if (!outcome.ok) {
					await auditDevice(
						{
							action: "platform.device.pause_refused",
							deviceId: device.id,
							orgId,
							reason,
							actorUserId: actor.id,
							temporaryGrant: actor.temporaryGrant,
							stepUpAt,
							after: { isPaused: input.isPaused, code: outcome.code, error: outcome.error },
						},
						tx,
					);
					return { success: false as const, code: "pause_refused" as const, error: outcome.error };
				}

				await auditDevice(
					{
						action: "platform.device.pause",
						deviceId: device.id,
						orgId,
						reason,
						actorUserId: actor.id,
						temporaryGrant: actor.temporaryGrant,
						stepUpAt,
						before: { isPaused: outcome.wasPaused },
						after: { isPaused: input.isPaused },
					},
					tx,
				);

				return { success: true as const, isPaused: input.isPaused };
			});
		});
	} catch (e) {
		if (isStepUpRequiredError(e)) {
			return { error: e.message, code: "step_up_required" };
		}
		console.error(
			"[platform] remoteSetDevicePause error:",
			e instanceof Error ? e.message : "unknown error",
		);
		return { error: "Failed to change the schedule state." };
	}
}

/** First org of the farm that owns a device's pond (audit orgId). */
async function orgIdForDevice(farmId: string | null): Promise<string | null> {
	if (!farmId) return null;
	const orgs = await orgsForFarms([farmId]);
	return orgs.get(farmId)?.[0]?.id ?? null;
}
