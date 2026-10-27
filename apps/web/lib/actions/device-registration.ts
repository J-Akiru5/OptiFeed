"use server";

import { resolveOrgScope } from "@/lib/auth/org-scope";
import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";
import {
	DUPLICATE_MAC_MESSAGE,
	createDeviceCredentials,
	validateDeviceRegistration,
} from "@/lib/device-registration";
import prisma from "@/lib/prisma";
import { getOrgSettings } from "@/lib/settings/org";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

/**
 * Tenant device registration (issue #190 / decision E6).
 *
 * Same validation and credential minting as the superadmin registry, but the
 * caller is an org OWNER/ADMIN holding `claim_feeder` and the target pond must
 * be inside their org scope. The org policy decides the starting state:
 *
 * - SELF_REGISTER → the device is created APPROVED and its token is returned
 *   once, exactly like the platform flow;
 * - ADMIN_APPROVAL (default) → the device is created PENDING, its token is
 *   generated but never returned, and an org admin must approve it before the
 *   reveal action (and every device route) will accept it.
 *
 * The platform registry is untouched: it still requires a platform admin, a
 * reason and a step-up, and always creates APPROVED devices.
 */

const DEVICES_PATH = "/[locale]/(admin)/admin/devices";

export type TenantDeviceActionState = { success: true } | { error: string };

export type AddTenantDeviceResult =
	| {
			success: true;
			deviceId: string;
			mac: string;
			approvalStatus: "APPROVED" | "PENDING";
			/** Returned only for an immediately approved (self-registered) device. */
			token?: string;
	  }
	| { error: string };

export type TenantPondOption = { id: string; name: string };

export type TenantRegistrationOptions = {
	orgId: string;
	orgName: string;
	mode: "ADMIN_APPROVAL" | "SELF_REGISTER";
	ponds: TenantPondOption[];
};

/**
 * Ponds a member with `claim_feeder` may register a unit on: the caller's org
 * scope only. Returns the current registration policy so the form can explain
 * whether the token appears immediately or after approval.
 */
export async function getTenantRegistrationOptions(): Promise<TenantRegistrationOptions | null> {
	await requireTenantAdmin();
	await requirePermission("claim_feeder");

	const scope = await resolveOrgScope();
	const orgId = scope.orgIds[0];
	if (!orgId) return null;

	const [org, ponds, settings] = await Promise.all([
		prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
		scope.pondIds.length > 0
			? prisma.pond.findMany({
					where: { id: { in: scope.pondIds } },
					select: { id: true, name: true },
					orderBy: { name: "asc" },
				})
			: Promise.resolve([]),
		getOrgSettings(orgId),
	]);

	return {
		orgId,
		orgName: org?.name ?? "",
		mode: settings.deviceRegistration,
		ponds,
	};
}

/**
 * Register a feeder on a pond of the caller's organization.
 *
 * Cross-org ponds and duplicate MACs are refused before anything is written;
 * the MAC is canonicalised by the shared validator. The credential is never
 * logged or audited, and a pending device never receives one.
 */
export async function addTenantDevice(input: {
	mac: string;
	label: string;
	pondId: string;
}): Promise<AddTenantDeviceResult> {
	await requireTenantAdmin();
	await requirePermission("claim_feeder");

	const scope = await resolveOrgScope();
	const orgId = scope.orgIds[0];
	if (!orgId) return { error: "You must belong to an organization to add a feeder." };

	const registration = validateDeviceRegistration({ mac: input.mac, label: input.label });
	if (!registration.ok) return { error: registration.error };
	const { mac, label } = registration;

	if (typeof input.pondId !== "string" || !scope.pondIds.includes(input.pondId)) {
		return { error: "That pond is outside your organization." };
	}

	const actor = await getCurrentUser();
	if (!actor) return { error: "Not authenticated." };

	try {
		const pond = await prisma.pond.findFirst({
			where: { id: input.pondId, ownerId: { in: scope.farmIds } },
			select: { id: true, ownerId: true },
		});
		if (!pond) return { error: "That pond is outside your organization." };

		const existing = await prisma.energyDevice.findFirst({
			where: { mac: { equals: mac, mode: "insensitive" } },
			select: { id: true },
		});
		if (existing) return { error: DUPLICATE_MAC_MESSAGE };

		const settings = await getOrgSettings(orgId);
		const approvalStatus = settings.deviceRegistration === "SELF_REGISTER" ? "APPROVED" : "PENDING";
		const credentials = createDeviceCredentials();

		const device = await prisma.$transaction(async (tx) => {
			const created = await tx.energyDevice.create({
				data: {
					mac,
					label,
					pondId: pond.id,
					token: credentials.token,
					tokenHash: credentials.tokenHash,
					approvalStatus,
				},
				select: { id: true },
			});
			await tx.deviceStateEvent.create({
				data: {
					deviceId: created.id,
					eventType: "device_registered",
					source: "user",
					actorId: actor.id,
					farmId: pond.ownerId,
					metadata: { orgId, approvalStatus, mac },
				},
			});
			return created;
		});

		revalidatePath(DEVICES_PATH, "page");

		return {
			success: true,
			deviceId: device.id,
			mac,
			approvalStatus,
			...(approvalStatus === "APPROVED" ? { token: credentials.token } : {}),
		};
	} catch (error) {
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
			return { error: DUPLICATE_MAC_MESSAGE };
		}
		console.error("[device-registration] addTenantDevice error:", error);
		return { error: "Failed to add the feeder." };
	}
}

/**
 * Approve a PENDING device of the caller's org. The token becomes revealable
 * through the normal rate-limited action; it is not returned here.
 */
export async function approveTenantDevice(deviceId: string): Promise<TenantDeviceActionState> {
	const result = await decidePendingDevice(deviceId, "APPROVED");
	if ("success" in result) revalidatePath(DEVICES_PATH, "page");
	return result;
}

/** Reject a PENDING device. Its token exists but no device route will accept it. */
export async function rejectTenantDevice(deviceId: string): Promise<TenantDeviceActionState> {
	const result = await decidePendingDevice(deviceId, "REJECTED");
	if ("success" in result) revalidatePath(DEVICES_PATH, "page");
	return result;
}

async function decidePendingDevice(
	deviceId: string,
	next: "APPROVED" | "REJECTED",
): Promise<TenantDeviceActionState> {
	await requireTenantAdmin();
	await requirePermission("claim_feeder");

	if (typeof deviceId !== "string" || !deviceId) {
		return { error: "A device is required." };
	}

	const scope = await resolveOrgScope();
	if (scope.pondIds.length === 0) {
		return { error: "Device not found in your organization." };
	}

	const actor = await getCurrentUser();
	if (!actor) return { error: "Not authenticated." };

	const device = await prisma.energyDevice.findFirst({
		where: {
			id: deviceId,
			pondId: { in: scope.pondIds },
			approvalStatus: "PENDING",
		},
		select: { id: true, pond: { select: { ownerId: true } } },
	});
	if (!device) return { error: "Device not found in your organization." };

	try {
		await prisma.$transaction(async (tx) => {
			await tx.energyDevice.update({
				where: { id: device.id },
				data: { approvalStatus: next },
			});
			await tx.deviceStateEvent.create({
				data: {
					deviceId: device.id,
					eventType: next === "APPROVED" ? "device_approved" : "device_rejected",
					source: "user",
					actorId: actor.id,
					farmId: device.pond?.ownerId ?? null,
				},
			});
		});
		return { success: true };
	} catch (error) {
		console.error("[device-registration] decidePendingDevice error:", error);
		return { error: "Failed to update the device." };
	}
}
