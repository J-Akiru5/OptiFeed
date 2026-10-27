import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import {
	E2E_DEVICE_MACS,
	E2E_PREFIX,
	assertE2eEnvironment,
	assertE2eIdentifier,
	isE2eEmail,
	isE2eIdentifier,
	isE2eMac,
	isMainModule,
} from "./guards";

/**
 * Delete ONLY the isolated e2e fixture (mission T-08).
 *
 * The suite runs against the production project, so this script:
 * - collects rows by the reserved "e2e-" prefix, the two fake MACs, or a
 *   parent that is already confirmed e2e-owned;
 * - validates every collected identifier BEFORE the first delete and refuses
 *   the whole run when anything does not match;
 * - deletes children before parents in a safe order;
 * - deletes the matching Supabase auth accounts (e2e- local part only);
 * - supports --dry-run, which performs no writes at all.
 *
 * It never deletes demo-farmer-1, superadmin or any other account.
 */

type CleanupCounts = {
	organizations: number;
	users: number;
	farms: number;
	ponds: number;
	devices: number;
	memberships: number;
	membershipPermissions: number;
	platformAdmins: number;
	deviceRows: number;
	pondRows: number;
	auditRows: number;
	keptAuditRows: number;
	rateLimitRows: number;
	authUsers: number;
};

const LOOPBACK_LOGIN_KEYS = ["rl:login:::1", "rl:login:127.0.0.1", "rl:login:::ffff:127.0.0.1"];

export type CleanupSummary = {
	host: string;
	dryRun: boolean;
	counts: CleanupCounts;
	organizations: string[];
	users: string[];
	ponds: string[];
	devices: { label: string; mac: string }[];
	authUsers: { id: string; email: string }[];
};

type CleanupOptions = {
	prisma: PrismaClient;
	supabase: SupabaseClient;
	env?: Record<string, string | undefined>;
	dryRun?: boolean;
};

type Collected = {
	organizations: { id: string; name: string }[];
	users: { id: string; farmId: string; email: string; supabaseId: string }[];
	farms: { id: string; ownerId: string }[];
	ponds: { id: string; name: string; ownerId: string; farmId: string }[];
	devices: { id: string; label: string; mac: string; pondId: string | null }[];
};

type AuthUser = { id: string; email: string };

function refuse(label: string, value: string): never {
	throw new Error(
		`Refusing e2e cleanup: ${label} "${value}" does not match the "${E2E_PREFIX}" fixture prefix or a reserved e2e identifier. Nothing was deleted.`,
	);
}

async function collectTargets(prisma: PrismaClient): Promise<Collected> {
	const organizations = await prisma.organization.findMany({
		where: {
			OR: [{ id: { startsWith: E2E_PREFIX } }, { name: { startsWith: E2E_PREFIX } }],
		},
		select: { id: true, name: true },
	});

	const users = await prisma.user.findMany({
		where: {
			OR: [{ farmId: { startsWith: E2E_PREFIX } }, { email: { startsWith: E2E_PREFIX } }],
		},
		select: { id: true, farmId: true, email: true, supabaseId: true },
	});

	const farms = await prisma.farm.findMany({
		where: { ownerId: { startsWith: E2E_PREFIX } },
		select: { id: true, ownerId: true },
	});

	const farmIds = farms.map((farm) => farm.id);
	const ownerFarmIds = users.map((user) => user.farmId);

	const ponds = await prisma.pond.findMany({
		where: {
			OR: [
				{ id: { startsWith: E2E_PREFIX } },
				{ name: { startsWith: E2E_PREFIX } },
				...(ownerFarmIds.length > 0 ? [{ ownerId: { in: ownerFarmIds } }] : []),
				...(farmIds.length > 0 ? [{ farmId: { in: farmIds } }] : []),
			],
		},
		select: { id: true, name: true, ownerId: true, farmId: true },
	});

	const pondIds = ponds.map((pond) => pond.id);
	const devices = await prisma.energyDevice.findMany({
		where: {
			OR: [
				{ id: { startsWith: E2E_PREFIX } },
				{ label: { startsWith: E2E_PREFIX } },
				{ mac: { in: [...E2E_DEVICE_MACS] } },
				...(pondIds.length > 0 ? [{ pondId: { in: pondIds } }] : []),
			],
		},
		select: { id: true, label: true, mac: true, pondId: true },
	});

	return { organizations, users, farms, ponds, devices };
}

/** Validate the complete plan before the first write. */
function validateTargets(targets: Collected): void {
	const ownerFarmIds = new Set(targets.users.map((user) => user.farmId));
	const farmIds = new Set(targets.farms.map((farm) => farm.id));
	const pondIds = new Set(targets.ponds.map((pond) => pond.id));

	for (const organization of targets.organizations) {
		if (!isE2eIdentifier(organization.id) && !isE2eIdentifier(organization.name)) {
			refuse("organization", organization.name);
		}
	}
	for (const user of targets.users) {
		if (!isE2eIdentifier(user.farmId) && !isE2eEmail(user.email)) {
			refuse("user", user.farmId);
		}
	}
	for (const farm of targets.farms) {
		if (!isE2eIdentifier(farm.ownerId)) refuse("farm owner", farm.ownerId);
	}
	for (const pond of targets.ponds) {
		const ownedByFixture =
			ownerFarmIds.has(pond.ownerId) || farmIds.has(pond.farmId) || isE2eIdentifier(pond.name);
		if (!isE2eIdentifier(pond.id) && !ownedByFixture) refuse("pond", pond.name);
	}
	for (const device of targets.devices) {
		const ownedByFixture = Boolean(device.pondId && pondIds.has(device.pondId));
		if (
			!isE2eIdentifier(device.id) &&
			!isE2eIdentifier(device.label) &&
			!isE2eMac(device.mac) &&
			!ownedByFixture
		) {
			refuse("device", device.label);
		}
	}
}

async function listE2eAuthUsers(supabase: SupabaseClient): Promise<AuthUser[]> {
	const matches: AuthUser[] = [];
	for (let page = 1; page <= 100; page++) {
		const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
		if (error) throw new Error(`Could not list Supabase users: ${error.message}`);
		const users = data?.users ?? [];
		for (const user of users) {
			if (!user.email || !isE2eEmail(user.email)) continue;
			// Refuse rather than silently skip an odd match.
			assertE2eIdentifier(user.email.split("@")[0], "auth account");
			matches.push({ id: user.id, email: user.email });
		}
		if (users.length < 200) break;
	}
	return matches;
}

function countOf(result: { count: number } | undefined): number {
	return result?.count ?? 0;
}

/**
 * Execute (or preview) the cleanup. Exported for the guard unit tests.
 */
export async function runCleanup(options: CleanupOptions): Promise<CleanupSummary> {
	const { host } = assertE2eEnvironment(options.env ?? process.env);
	const dryRun = options.dryRun === true;
	const { prisma, supabase } = options;

	const targets = await collectTargets(prisma);
	validateTargets(targets);

	const authUsers = await listE2eAuthUsers(supabase);

	const orgIds = targets.organizations.map((organization) => organization.id);
	const userIds = targets.users.map((user) => user.id);
	const farmIds = targets.farms.map((farm) => farm.id);
	const pondIds = targets.ponds.map((pond) => pond.id);
	const deviceIds = targets.devices.map((device) => device.id);

	const counts: CleanupCounts = {
		organizations: targets.organizations.length,
		users: targets.users.length,
		farms: targets.farms.length,
		ponds: targets.ponds.length,
		devices: targets.devices.length,
		memberships: 0,
		membershipPermissions: 0,
		platformAdmins: 0,
		deviceRows: 0,
		pondRows: 0,
		auditRows: 0,
		keptAuditRows: 0,
		rateLimitRows: 0,
		authUsers: authUsers.length,
	};

	if (!dryRun) {
		// ── Device-scoped rows ──────────────────────────────────────────────
		if (deviceIds.length > 0) {
			counts.deviceRows += countOf(
				await prisma.feedLevelLog.deleteMany({ where: { deviceId: { in: deviceIds } } }),
			);
			counts.deviceRows += countOf(
				await prisma.feedRequest.deleteMany({ where: { deviceId: { in: deviceIds } } }),
			);
			counts.deviceRows += countOf(
				await prisma.feedEvent.deleteMany({ where: { deviceId: { in: deviceIds } } }),
			);
			counts.deviceRows += countOf(
				await prisma.deviceStateEvent.deleteMany({ where: { deviceId: { in: deviceIds } } }),
			);
			counts.pondRows += countOf(
				await prisma.scheduleCommand.deleteMany({ where: { deviceId: { in: deviceIds } } }),
			);
		}

		// ── Pond-scoped rows ────────────────────────────────────────────────
		if (pondIds.length > 0) {
			const biomassLogs = await prisma.biomassLog.findMany({
				where: { pondId: { in: pondIds } },
				select: { id: true },
			});
			if (biomassLogs.length > 0) {
				const biomassIds = biomassLogs.map((log) => log.id);
				await prisma.fishSample.deleteMany({ where: { biomassLogId: { in: biomassIds } } });
				await prisma.biomassLog.deleteMany({ where: { id: { in: biomassIds } } });
			}

			counts.pondRows += countOf(
				await prisma.scheduleCommand.deleteMany({ where: { pondId: { in: pondIds } } }),
			);
			counts.pondRows += countOf(
				await prisma.fcrReport.deleteMany({ where: { pondId: { in: pondIds } } }),
			);
			counts.pondRows += countOf(
				await prisma.notification.deleteMany({ where: { pondId: { in: pondIds } } }),
			);
			counts.pondRows += countOf(
				await prisma.reminderLog.deleteMany({ where: { pondId: { in: pondIds } } }),
			);
			counts.pondRows += countOf(
				await prisma.pondEvent.deleteMany({ where: { pondId: { in: pondIds } } }),
			);
			counts.pondRows += countOf(
				await prisma.cropCycle.deleteMany({ where: { pondId: { in: pondIds } } }),
			);
			counts.pondRows += countOf(
				await prisma.pondOwnershipHistory.deleteMany({ where: { pondId: { in: pondIds } } }),
			);

			// Deprecated Device rows (schema keeps them until H9) still hold a
			// Restrict FK to Pond, so they must go before the pond.
			const legacyDevices = await prisma.device.findMany({
				where: { pondId: { in: pondIds } },
				select: { id: true },
			});
			if (legacyDevices.length > 0) {
				const legacyIds = legacyDevices.map((device) => device.id);
				await prisma.feedingEvent.deleteMany({ where: { deviceId: { in: legacyIds } } });
				await prisma.device.deleteMany({ where: { id: { in: legacyIds } } });
			}
		}

		// ── Membership / grant rows ─────────────────────────────────────────
		const membershipConditions = [
			...(orgIds.length > 0 ? [{ orgId: { in: orgIds } }] : []),
			...(userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
		];
		if (membershipConditions.length > 0) {
			const memberships = await prisma.membership.findMany({
				where: { OR: membershipConditions },
				select: { id: true },
			});
			const membershipIds = memberships.map((membership) => membership.id);
			counts.memberships = membershipIds.length;
			if (membershipIds.length > 0) {
				counts.membershipPermissions = countOf(
					await prisma.membershipPermission.deleteMany({
						where: { membershipId: { in: membershipIds } },
					}),
				);
			}
			await prisma.membership.deleteMany({ where: { OR: membershipConditions } });
		}

		if (userIds.length > 0) {
			counts.platformAdmins = countOf(
				await prisma.platformAdmin.deleteMany({ where: { userId: { in: userIds } } }),
			);
		}

		const auditConditions = [
			...(orgIds.length > 0 ? [{ orgId: { in: orgIds } }] : []),
			...(userIds.length > 0 ? [{ actorUserId: { in: userIds } }] : []),
			...(userIds.length > 0 ? [{ targetId: { in: userIds } }] : []),
			...(deviceIds.length > 0 ? [{ targetId: { in: deviceIds } }] : []),
			...(orgIds.length > 0 ? [{ targetId: { in: orgIds } }] : []),
		];
		const sessionConditions = [
			...(orgIds.length > 0 ? [{ orgId: { in: orgIds } }] : []),
			...(userIds.length > 0 ? [{ actorUserId: { in: userIds } }] : []),
		];
		if (sessionConditions.length > 0) {
			counts.auditRows += countOf(
				await prisma.impersonationSession.deleteMany({ where: { OR: sessionConditions } }),
			);
		}
		// PlatformAuditLog is append-only: a database trigger raises on every
		// UPDATE or DELETE (migration 20261017000000_add_platform_admin). The
		// rows written by an e2e run are kept as the permanent record of what the
		// suite did; only their count is reported.
		if (auditConditions.length > 0) {
			counts.keptAuditRows += await prisma.platformAuditLog.count({
				where: { OR: auditConditions },
			});
		}

		// ── Parents ─────────────────────────────────────────────────────────
		// Failed-login counters are keyed by login id, including the deliberate
		// bad login in the auth spec, so scope them by the same prefix.
		await prisma.userLockout.deleteMany({ where: { farmId: { startsWith: E2E_PREFIX } } });
		await prisma.loginLockout.deleteMany({ where: { farmId: { startsWith: E2E_PREFIX } } });
		// Rate-limit buckets the suite filled: per-user keys end in an e2e user
		// id, and login keys use the loopback address of the local test server
		// (production traffic never arrives from loopback).
		counts.rateLimitRows += countOf(
			await prisma.rateLimitBucket.deleteMany({
				where: {
					OR: [
						...userIds.map((id) => ({ key: { endsWith: `:${id}` } })),
						...LOOPBACK_LOGIN_KEYS.map((key) => ({ key })),
					],
				},
			}),
		);
		if (deviceIds.length > 0) {
			await prisma.energyDevice.deleteMany({ where: { id: { in: deviceIds } } });
		}
		if (pondIds.length > 0) {
			await prisma.pond.deleteMany({ where: { id: { in: pondIds } } });
		}
		if (farmIds.length > 0) {
			await prisma.farm.deleteMany({ where: { id: { in: farmIds } } });
		}
		if (userIds.length > 0) {
			await prisma.user.deleteMany({ where: { id: { in: userIds } } });
		}
		if (orgIds.length > 0) {
			await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
		}

		// ── Supabase auth accounts ──────────────────────────────────────────
		for (const user of authUsers) {
			assertE2eIdentifier(user.email.split("@")[0], "auth account");
			const { error } = await supabase.auth.admin.deleteUser(user.id);
			if (error) throw new Error(`Could not delete auth account ${user.email}: ${error.message}`);
		}
	}

	return {
		host,
		dryRun,
		counts,
		organizations: targets.organizations.map((organization) => organization.id),
		users: targets.users.map((user) => user.farmId),
		ponds: targets.ponds.map((pond) => pond.id),
		devices: targets.devices.map((device) => ({ label: device.label, mac: device.mac })),
		authUsers: authUsers.map((user) => ({ id: user.id, email: user.email })),
	};
}

function printSummary(summary: CleanupSummary): void {
	console.log("");
	console.log("============================================");
	console.log(summary.dryRun ? "  E2E CLEANUP — DRY RUN (nothing deleted)" : "  E2E CLEANUP");
	console.log("============================================");
	console.log(`Target host:        ${summary.host}`);
	console.log(`Organizations:      ${summary.counts.organizations}`);
	console.log(`Users:              ${summary.counts.users}`);
	console.log(`Farms:              ${summary.counts.farms}`);
	console.log(`Ponds:              ${summary.counts.ponds}`);
	console.log(`Devices:            ${summary.counts.devices}`);
	console.log(`Memberships:        ${summary.counts.memberships}`);
	console.log(`Permission rows:    ${summary.counts.membershipPermissions}`);
	console.log(`Platform grants:    ${summary.counts.platformAdmins}`);
	console.log(`Device child rows:  ${summary.counts.deviceRows}`);
	console.log(`Pond child rows:    ${summary.counts.pondRows}`);
	console.log(`View-as session rows deleted: ${summary.counts.auditRows}`);
	console.log(`Platform audit rows kept (append-only by design): ${summary.counts.keptAuditRows}`);
	console.log(`Rate-limit rows:    ${summary.counts.rateLimitRows}`);
	console.log(`Auth accounts:      ${summary.counts.authUsers}`);
	console.log("");
	console.log("Fixture identifiers:");
	console.log(`  orgs:    ${summary.organizations.join(", ") || "(none)"}`);
	console.log(`  users:   ${summary.users.join(", ") || "(none)"}`);
	console.log(`  ponds:   ${summary.ponds.join(", ") || "(none)"}`);
	console.log(
		`  devices: ${summary.devices.map((device) => `${device.label} (${device.mac})`).join(", ") || "(none)"}`,
	);
	console.log(`  auth:    ${summary.authUsers.map((user) => user.email).join(", ") || "(none)"}`);
	console.log("============================================");
}

async function main(): Promise<void> {
	try {
		loadEnvFile(".env");
	} catch {
		// .env may be absent; the ambient environment is used instead.
	}

	const dryRun = process.argv.includes("--dry-run");

	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !serviceRoleKey) {
		throw new Error(
			"NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Run from apps/web so .env is loaded.",
		);
	}

	const supabase = createClient(url, serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false },
	});
	const prisma = new PrismaClient();

	try {
		const summary = await runCleanup({ prisma, supabase, dryRun });
		printSummary(summary);
		if (dryRun && summary.counts.organizations + summary.counts.users > 0) {
			console.log("Dry run found e2e data. Re-run without --dry-run to delete it.");
		}
	} finally {
		await prisma.$disconnect();
	}
}

if (isMainModule(import.meta.url)) {
	main().catch((error) => {
		console.error("[e2e cleanup] failed:", error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
