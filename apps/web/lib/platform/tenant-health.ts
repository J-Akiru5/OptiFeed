import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import type { DeviceStatusPolicy } from "@/lib/device-status";
import type { PaginationState } from "@/lib/pagination";
import { resolvePagination } from "@/lib/pagination";
import {
	type TenantHealthDeviceInput,
	type TenantHealthInput,
	type TenantHealthRow,
	type TenantHealthSummary,
	buildTenantHealthRows,
	paginateTenantRows,
	summarizeTenants,
} from "@/lib/platform/tenant-health-rules";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
import { getListPageSize } from "@/lib/settings/platform";

/**
 * Tenant health loader (issue #479, M3C.3).
 *
 * Read-only and platform-gated. Six bounded reads build the tenant rows: the
 * organizations, their active memberships, the farms those members own, those
 * farms' ponds, the ponds' devices, and the open alerts on those ponds. The
 * farm → organization step is the same resolution the fleet monitor and the
 * incident queue use (a `Pond` has no `organizationId`; the tenant is reached
 * through the farm owner's active membership), applied here in one pass.
 *
 * Failure handling matches the other command-center pages: a throwing source or
 * an unreadable `device.status` policy returns `sourceError` with an `unknown`
 * summary, so a broken query can never be rendered as healthy tenants.
 *
 * All reads are capped, and `truncated` says when a cap was reached — a cut
 * device list means a tenant's fleet numbers are a floor, not a total.
 */

export const TENANT_HEALTH_ORG_LIMIT = 500;
export const TENANT_HEALTH_DEVICE_LIMIT = 2000;

export interface TenantHealthPage {
	checkedAt: Date;
	rows: TenantHealthRow[];
	summary: TenantHealthSummary;
	pagination: PaginationState;
	/** Organizations that exist, before paging. */
	totalTenants: number;
	truncated: boolean;
	sourceError: boolean;
	/** False when the policy could not be read; every device state is then unknown. */
	policyAvailable: boolean;
}

export interface TenantHealthDataset {
	checkedAt: Date;
	/** Every organization, already ranked worst first. */
	rows: TenantHealthRow[];
	summary: TenantHealthSummary;
	totalTenants: number;
	truncated: boolean;
	sourceError: boolean;
	/** False when the policy could not be read; every device state is then unknown. */
	policyAvailable: boolean;
}

/**
 * The unpaginated tenant rows. The tenant table pages these and the
 * organization comparison picks from the same list, so both pages read one
 * code path and one set of caps.
 */
export async function getTenantHealthDataset(now: Date = new Date()): Promise<TenantHealthDataset> {
	await requirePlatformAdmin();

	try {
		const [policy, organizations] = await Promise.all([getDeviceStatusPolicy(), buildInputs()]);
		const rows = buildTenantHealthRows(organizations.inputs, now, policy);

		return {
			checkedAt: now,
			rows,
			summary: summarizeTenants(rows),
			totalTenants: rows.length,
			truncated: organizations.truncated,
			sourceError: false,
			policyAvailable: true,
		};
	} catch {
		return {
			checkedAt: now,
			rows: [],
			summary: summarizeTenants([]),
			totalTenants: 0,
			truncated: false,
			sourceError: true,
			policyAvailable: false,
		};
	}
}

export async function getTenantHealth(page = 1, now: Date = new Date()): Promise<TenantHealthPage> {
	const [dataset, pageSize] = await Promise.all([getTenantHealthDataset(now), getListPageSize()]);
	const { rows, pagination } = paginateTenantRows(dataset.rows, page, pageSize);

	return {
		checkedAt: dataset.checkedAt,
		rows,
		summary: dataset.summary,
		pagination,
		totalTenants: dataset.totalTenants,
		truncated: dataset.truncated,
		sourceError: dataset.sourceError,
		policyAvailable: dataset.policyAvailable,
	};
}

interface BuildInputsResult {
	inputs: TenantHealthInput[];
	truncated: boolean;
}

/**
 * Every query here is bounded. A tenant with no ponds, or whose ponds have no
 * devices, is still returned — with empty device data, so its state becomes
 * `unknown` rather than disappearing from the list.
 */
async function buildInputs(): Promise<BuildInputsResult> {
	const orgRows = await prisma.organization.findMany({
		orderBy: { name: "asc" },
		take: TENANT_HEALTH_ORG_LIMIT + 1,
		select: { id: true, name: true, status: true },
	});
	const truncatedOrgs = orgRows.length > TENANT_HEALTH_ORG_LIMIT;
	const orgs = truncatedOrgs ? orgRows.slice(0, TENANT_HEALTH_ORG_LIMIT) : orgRows;
	if (orgs.length === 0) return { inputs: [], truncated: false };

	const orgIds = orgs.map((org) => org.id);
	const memberships = await prisma.membership.findMany({
		where: { orgId: { in: orgIds }, revokedAt: null },
		select: { orgId: true, userId: true },
	});

	const membersByOrg = new Map<string, number>();
	for (const membership of memberships) {
		membersByOrg.set(membership.orgId, (membersByOrg.get(membership.orgId) ?? 0) + 1);
	}

	const users = memberships.length
		? await prisma.user.findMany({
				where: { id: { in: [...new Set(memberships.map((m) => m.userId))] } },
				select: { id: true, farmId: true },
			})
		: [];
	const farmByUser = new Map(users.map((user) => [user.id, user.farmId]));

	// One farm belongs to one tenant here: organizations are read by name, so the
	// first membership that reaches a farm wins and the answer is stable.
	const orgByFarm = new Map<string, string>();
	for (const membership of memberships) {
		const farmId = farmByUser.get(membership.userId);
		if (!farmId || orgByFarm.has(farmId)) continue;
		orgByFarm.set(farmId, membership.orgId);
	}

	const farmIds = [...orgByFarm.keys()];
	const ponds = farmIds.length
		? await prisma.pond.findMany({
				where: { ownerId: { in: farmIds } },
				select: { id: true, ownerId: true },
			})
		: [];

	const orgByPond = new Map<string, string>();
	const pondsByOrg = new Map<string, number>();
	for (const pond of ponds) {
		const orgId = orgByFarm.get(pond.ownerId);
		if (!orgId) continue;
		orgByPond.set(pond.id, orgId);
		pondsByOrg.set(orgId, (pondsByOrg.get(orgId) ?? 0) + 1);
	}

	const pondIds = [...orgByPond.keys()];
	const deviceRows = pondIds.length
		? await prisma.energyDevice.findMany({
				where: { pondId: { in: pondIds } },
				select: { id: true, pondId: true, lastSeenAt: true },
				take: TENANT_HEALTH_DEVICE_LIMIT + 1,
			})
		: [];
	const truncatedDevices = deviceRows.length > TENANT_HEALTH_DEVICE_LIMIT;

	const alerts = pondIds.length
		? await prisma.notification.findMany({
				where: { pondId: { in: pondIds }, acknowledgedAt: null, autoCleared: false },
				select: { pondId: true },
			})
		: [];

	const devicesByOrg = new Map<string, TenantHealthDeviceInput[]>();
	for (const device of deviceRows.slice(0, TENANT_HEALTH_DEVICE_LIMIT)) {
		const orgId = device.pondId ? orgByPond.get(device.pondId) : undefined;
		if (!orgId) continue;
		const bucket = devicesByOrg.get(orgId);
		const entry = { id: device.id, lastSeenAt: device.lastSeenAt };
		if (bucket) bucket.push(entry);
		else devicesByOrg.set(orgId, [entry]);
	}

	const alertsByOrg = new Map<string, number>();
	for (const alert of alerts) {
		const orgId = alert.pondId ? orgByPond.get(alert.pondId) : undefined;
		if (!orgId) continue;
		alertsByOrg.set(orgId, (alertsByOrg.get(orgId) ?? 0) + 1);
	}

	return {
		inputs: orgs.map((org) => ({
			orgId: org.id,
			orgName: org.name,
			orgStatus: org.status,
			members: membersByOrg.get(org.id) ?? 0,
			ponds: pondsByOrg.get(org.id) ?? 0,
			devices: devicesByOrg.get(org.id) ?? [],
			openAlerts: alertsByOrg.get(org.id) ?? 0,
		})),
		truncated: truncatedOrgs || truncatedDevices,
	};
}
