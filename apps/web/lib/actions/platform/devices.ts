"use server";

import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import { isStepUpRequiredError, withStepUp } from "@/lib/auth/step-up";
import { generateDeviceToken, hashToken } from "@/lib/device-auth";
import { canonicalMac } from "@/lib/device-mac";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { headers } from "next/headers";

/**
 * Platform device registry (plan v2, phase M3F).
 *
 * Registering hardware is inventory work, not farm operation: nothing here
 * feeds, schedules or controls a feeder, so the "no farmer function" rule of
 * lib/actions/superadmin.ts still holds. Every export is gated by
 * requirePlatformAdmin(), and every mutation requires a reason and writes a
 * PlatformAuditLog row in the same transaction.
 *
 * Device tokens: a new token is returned to the caller exactly once in the
 * action result. Because of plan decision T16 the plaintext is still stored in
 * EnergyDevice.token (the tenant "Show token" reveal needs it) until M4.3. The
 * token never appears in an audit row, a log line or a page payload.
 */

const MIN_REASON_LENGTH = 10;
const MAX_LABEL_LENGTH = 64;
const PAGE_SIZE = 50;
const MAX_LABELS = 40;

function requireReason(reason: string | undefined): string {
	const trimmed = reason?.trim() ?? "";
	if (trimmed.length < MIN_REASON_LENGTH) {
		throw new Error(`A reason of at least ${MIN_REASON_LENGTH} characters is required.`);
	}
	return trimmed;
}

/**
 * The acting platform admin, and whether they act on a time-boxed demo grant
 * (plan T10): such rows are flagged so the audit explorer can tell them apart.
 */
async function actorContext(): Promise<{ id: string; temporaryGrant: boolean }> {
	const user = await getCurrentUser();
	if (!user) throw new Error("Not authenticated.");
	const grant = await prisma.platformAdmin.findUnique({
		where: { userId: user.id },
		select: { expiresAt: true },
	});
	return { id: user.id, temporaryGrant: Boolean(grant?.expiresAt) };
}

/** Request origin for the audit row (who/what/when/where). */
async function requestOrigin(): Promise<{ ip: string | null; userAgent: string | null }> {
	try {
		const h = await headers();
		const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
		return {
			ip: forwarded || h.get("x-real-ip") || null,
			userAgent: h.get("user-agent")?.slice(0, 512) ?? null,
		};
	} catch {
		return { ip: null, userAgent: null };
	}
}

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
	const origin = await requestOrigin();
	await tx.platformAuditLog.create({
		data: {
			actorUserId: data.actorUserId,
			action: data.action,
			targetType: "energy_device",
			targetId: data.deviceId,
			orgId: data.orgId,
			reason: data.reason,
			stepUpAt: data.stepUpAt,
			temporaryGrant: data.temporaryGrant,
			ip: origin.ip,
			userAgent: origin.userAgent,
			...(data.before !== undefined ? { before: data.before } : {}),
			...(data.after !== undefined ? { after: data.after } : {}),
		},
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
	const where: Prisma.EnergyDeviceWhereInput = query
		? {
				OR: [
					{ mac: { contains: query, mode: "insensitive" } },
					{ label: { contains: query, mode: "insensitive" } },
				],
			}
		: {};

	const [total, devices] = await Promise.all([
		prisma.energyDevice.count({ where }),
		prisma.energyDevice.findMany({
			where,
			orderBy: { createdAt: "desc" },
			skip: (page - 1) * PAGE_SIZE,
			take: PAGE_SIZE,
			select: {
				id: true,
				label: true,
				mac: true,
				lastSeenAt: true,
				createdAt: true,
				pond: { select: { id: true, name: true, ownerId: true } },
			},
		}),
	]);

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
			pond: d.pond ? { id: d.pond.id, name: d.pond.name } : null,
			orgs: d.pond ? (orgsByFarm.get(d.pond.ownerId) ?? []) : [],
		})),
		total,
		page,
		pageSize: PAGE_SIZE,
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

export type RegisterDeviceResult =
	| { success: true; deviceId: string; mac: string; token: string }
	| StepUpRequiredResult
	| { error: string; code?: undefined };

const DUPLICATE_MAC_MESSAGE = "A device with this MAC is already registered.";

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

	const mac = canonicalMac(typeof input.mac === "string" ? input.mac : "");
	if (!mac) return { error: "Enter the 12-digit MAC, for example A4:CF:12:7E:3B:09." };

	const label = typeof input.label === "string" ? input.label.trim() : "";
	if (!label) return { error: "A device label is required." };
	if (label.length > MAX_LABEL_LENGTH) {
		return { error: `The label can be at most ${MAX_LABEL_LENGTH} characters.` };
	}

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
			const newToken = generateDeviceToken();
			const id = await prisma.$transaction(async (tx) => {
				const device = await tx.energyDevice.create({
					data: { mac, label, pondId: pond.id, token: newToken, tokenHash: hashToken(newToken) },
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
			return { deviceId: id, token: newToken };
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
	| { error: string; code?: undefined };

/**
 * Issue a new token for a device. The old token stops authenticating at once,
 * because device auth looks tokens up by hash. The unit keeps failing until
 * the new token is set on it through the setup portal.
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
		const device = await prisma.energyDevice.findUnique({
			where: { id: input.deviceId },
			select: { id: true, mac: true, pond: { select: { ownerId: true } } },
		});
		if (!device) return { error: "Device not found." };

		const orgs = device.pond ? await orgsForFarms([device.pond.ownerId]) : new Map();
		const orgId = device.pond ? (orgs.get(device.pond.ownerId)?.[0]?.id ?? null) : null;

		const actor = await actorContext();

		// A rotation invalidates the unit's working credential, so it needs a
		// fresh step-up just like registration.
		const token = await withStepUp(async (stepUpAt) => {
			const newToken = generateDeviceToken();
			await prisma.$transaction(async (tx) => {
				await tx.energyDevice.update({
					where: { id: device.id },
					data: { token: newToken, tokenHash: hashToken(newToken) },
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
			return newToken;
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
 */
export async function getPlatformDevicesForLabels(
	deviceIds: string[],
): Promise<PlatformDeviceLabelRow[]> {
	await requirePlatformAdmin();

	const ids = [
		...new Set(deviceIds.filter((id) => typeof id === "string" && id.trim().length > 0)),
	].slice(0, MAX_LABELS);
	if (ids.length === 0) return [];

	const devices = await prisma.energyDevice.findMany({
		where: { id: { in: ids } },
		select: { id: true, label: true, mac: true },
	});
	const order = new Map(ids.map((id, index) => [id, index]));
	return devices.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
