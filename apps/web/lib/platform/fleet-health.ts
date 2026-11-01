import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import type { DeviceStatusPolicy } from "@/lib/device-status";
import {
	type FleetDeviceInput,
	type FleetSummary,
	type TenantFleetRow,
	buildTenantFleetRows,
	summarizeFleet,
} from "@/lib/platform/fleet-health-rules";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";

/**
 * Fleet monitor loader (issue #479, M3C.4).
 *
 * Read-only and platform-gated: one bounded device query, the same farm → user →
 * active membership → organization resolution the device registry already uses
 * (M3.9), and the configured `device.status` policy handed to the pure rules in
 * `fleet-health-rules.ts`. No token or tokenHash is ever selected.
 *
 * A failing source is reported, not hidden: the caller receives
 * `sourceError: true` with an `unknown` summary, so the page cannot render a
 * broken query as a healthy fleet.
 */

/** Device tables stay bounded; the page says when the list was cut. */
export const FLEET_DEVICE_LIMIT = 1000;

export interface FleetMonitor {
	checkedAt: Date;
	/** Null when the policy itself could not be read, which makes the view unknown. */
	policy: DeviceStatusPolicy | null;
	rows: TenantFleetRow[];
	summary: FleetSummary;
	totalDevices: number;
	truncated: boolean;
	sourceError: boolean;
}

function emptyMonitor(now: Date): FleetMonitor {
	return {
		checkedAt: now,
		policy: null,
		rows: [],
		summary: { state: "unknown", counts: { ok: 0, degraded: 0, critical: 0, unknown: 0 } },
		totalDevices: 0,
		truncated: false,
		sourceError: true,
	};
}

export async function getFleetMonitor(now: Date = new Date()): Promise<FleetMonitor> {
	await requirePlatformAdmin();

	try {
		const [policy, devices] = await Promise.all([
			getDeviceStatusPolicy(),
			prisma.energyDevice.findMany({
				orderBy: { label: "asc" },
				take: FLEET_DEVICE_LIMIT + 1,
				select: {
					id: true,
					label: true,
					mac: true,
					lastSeenAt: true,
					pond: { select: { name: true, ownerId: true } },
				},
			}),
		]);

		const truncated = devices.length > FLEET_DEVICE_LIMIT;
		const bounded = truncated ? devices.slice(0, FLEET_DEVICE_LIMIT) : devices;

		// pond.ownerId is a farm id (one farm per farmer), so a device reaches its
		// tenant the same way the registry resolves it.
		const farmIds = [...new Set(bounded.flatMap((d) => (d.pond ? [d.pond.ownerId] : [])))];
		const users = farmIds.length
			? await prisma.user.findMany({
					where: { farmId: { in: farmIds } },
					select: { id: true, farmId: true },
				})
			: [];
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
					orderBy: { name: "asc" },
				})
			: [];

		const orgById = new Map(orgs.map((org) => [org.id, org]));
		const farmByUser = new Map(users.map((user) => [user.id, user.farmId]));
		const orgByFarm = new Map<string, { id: string; name: string }>();
		for (const membership of memberships) {
			const farmId = farmByUser.get(membership.userId);
			const org = orgById.get(membership.orgId);
			if (!farmId || !org || orgByFarm.has(farmId)) continue;
			orgByFarm.set(farmId, org);
		}

		const inputs: FleetDeviceInput[] = bounded.map((device) => {
			const org = device.pond ? (orgByFarm.get(device.pond.ownerId) ?? null) : null;
			return {
				id: device.id,
				label: device.label,
				mac: device.mac,
				lastSeenAt: device.lastSeenAt,
				tenantId: org?.id ?? null,
				tenantName: org?.name ?? null,
				pondName: device.pond?.name ?? null,
			};
		});

		const rows = buildTenantFleetRows(inputs, now, policy);

		return {
			checkedAt: now,
			policy,
			rows,
			summary: summarizeFleet(rows),
			totalDevices: bounded.length,
			truncated,
			sourceError: false,
		};
	} catch {
		return emptyMonitor(now);
	}
}
