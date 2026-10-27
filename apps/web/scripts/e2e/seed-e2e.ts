import { createHash, randomBytes } from "node:crypto";
import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import {
	E2E_DEVICE_LABEL,
	E2E_DEVICE_MACS,
	E2E_LOGIN_IDS,
	E2E_ORG,
	E2E_PLATFORM_GRANT_HOURS,
	E2E_POND,
	assertE2eEnvironment,
	isMainModule,
	requireE2ePassword,
} from "./guards";

/**
 * Seed the isolated e2e fixture (mission T-08, decision D5 amended).
 *
 * The integrator runs this against the production Supabase project while
 * PakaonAI is not in operation. Every row this script writes is therefore
 * owned by the reserved "e2e-" prefix; it never updates an existing non-e2e
 * account and never touches demo-farmer-1 or superadmin.
 *
 * Idempotent: re-running it resets the fixture (roles, permissions, device
 * token, grant expiry) instead of creating duplicates.
 */

const POND_EMAIL_DOMAIN = "pond.optifeed.local";

/** Mirrors lib/auth/session.ts buildPondEmail without importing server code. */
function buildPondEmail(loginId: string): string {
	return `${loginId.toLowerCase().trim()}@${POND_EMAIL_DOMAIN}`;
}

/**
 * Mirrors lib/device-auth.ts. Kept local so the script has no dependency on
 * the Next.js module graph (tsx runs it directly).
 */
export function generateDeviceToken(): string {
	return `esp32-tok-${randomBytes(16).toString("hex")}`;
}

export function hashDeviceToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export type SeedSummary = {
	host: string;
	organization: { id: string; name: string };
	users: { farmId: string; role: string }[];
	memberships: { farmId: string; orgId: string; role: string }[];
	pond: { id: string; name: string; ownerFarmId: string };
	device: { mac: string; label: string };
	platformAdmin: { farmId: string; expiresAt: string };
};

type AuthUser = { id: string; email?: string | null };

async function findAuthUserByEmail(
	supabase: SupabaseClient,
	email: string,
): Promise<AuthUser | null> {
	const target = email.toLowerCase();
	// The production project can hold more than one page of accounts.
	for (let page = 1; page <= 100; page++) {
		const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
		if (error) throw new Error(`Could not list Supabase users: ${error.message}`);
		const users = data?.users ?? [];
		const found = users.find((user) => user.email?.toLowerCase() === target);
		if (found) return found;
		if (users.length < 200) return null;
	}
	throw new Error("Could not page through the Supabase user list.");
}

async function ensureAuthUser(
	supabase: SupabaseClient,
	input: { email: string; password: string },
): Promise<string> {
	const existing = await findAuthUserByEmail(supabase, input.email);
	if (existing) {
		const { error } = await supabase.auth.admin.updateUserById(existing.id, {
			password: input.password,
			email_confirm: true,
		});
		if (error) throw new Error(`Could not update ${input.email}: ${error.message}`);
		return existing.id;
	}

	const { data, error } = await supabase.auth.admin.createUser({
		email: input.email,
		password: input.password,
		email_confirm: true,
	});
	if (error || !data?.user) {
		throw new Error(`Could not create ${input.email}: ${error?.message ?? "unknown error"}`);
	}
	return data.user.id;
}

/**
 * Create/reset the fixture. Exported so the unit tests can call it with mocks;
 * `main()` is the only caller in normal use.
 */
export async function seedE2e(input: {
	prisma: PrismaClient;
	supabase: SupabaseClient;
	password: string;
	host: string;
	now?: Date;
}): Promise<SeedSummary> {
	const now = input.now ?? new Date();

	if (!input.password) throw new Error("E2E_PASSWORD is required.");

	const farmerLogin = E2E_LOGIN_IDS.farmer;
	const adminLogin = E2E_LOGIN_IDS.admin;
	const platformLogin = E2E_LOGIN_IDS.platform;

	const farmerEmail = buildPondEmail(farmerLogin);
	const adminEmail = buildPondEmail(adminLogin);
	const platformEmail = buildPondEmail(platformLogin);

	const [farmerAuthId, adminAuthId, platformAuthId] = await Promise.all([
		ensureAuthUser(input.supabase, { email: farmerEmail, password: input.password }),
		ensureAuthUser(input.supabase, { email: adminEmail, password: input.password }),
		ensureAuthUser(input.supabase, { email: platformEmail, password: input.password }),
	]);

	const organization = await input.prisma.organization.upsert({
		where: { id: E2E_ORG.id },
		update: { name: E2E_ORG.name, type: E2E_ORG.type, status: E2E_ORG.status },
		create: {
			id: E2E_ORG.id,
			name: E2E_ORG.name,
			type: E2E_ORG.type,
			status: E2E_ORG.status,
		},
	});

	const farmer = await input.prisma.user.upsert({
		where: { farmId: farmerLogin },
		update: {
			supabaseId: farmerAuthId,
			email: farmerEmail,
			displayName: farmerLogin,
			role: "OPERATOR",
			mustChangePassword: false,
		},
		create: {
			supabaseId: farmerAuthId,
			farmId: farmerLogin,
			email: farmerEmail,
			displayName: farmerLogin,
			role: "OPERATOR",
			mustChangePassword: false,
		},
	});

	const admin = await input.prisma.user.upsert({
		where: { farmId: adminLogin },
		update: {
			supabaseId: adminAuthId,
			email: adminEmail,
			displayName: adminLogin,
			role: "ADMIN",
			mustChangePassword: false,
		},
		create: {
			supabaseId: adminAuthId,
			farmId: adminLogin,
			email: adminEmail,
			displayName: adminLogin,
			role: "ADMIN",
			mustChangePassword: false,
		},
	});

	const platformAdminUser = await input.prisma.user.upsert({
		where: { farmId: platformLogin },
		update: {
			supabaseId: platformAuthId,
			email: platformEmail,
			displayName: platformLogin,
			role: "ADMIN",
			mustChangePassword: false,
		},
		create: {
			supabaseId: platformAuthId,
			farmId: platformLogin,
			email: platformEmail,
			displayName: platformLogin,
			role: "ADMIN",
			mustChangePassword: false,
		},
	});

	// The tenant console is gated on Membership.role, not User.role.
	const farmerMembership = await input.prisma.membership.upsert({
		where: { orgId_userId: { orgId: organization.id, userId: farmer.id } },
		update: { role: "OPERATOR", revokedAt: null },
		create: { orgId: organization.id, userId: farmer.id, role: "OPERATOR" },
	});
	const adminMembership = await input.prisma.membership.upsert({
		where: { orgId_userId: { orgId: organization.id, userId: admin.id } },
		update: { role: "OWNER", revokedAt: null },
		create: { orgId: organization.id, userId: admin.id, role: "OWNER" },
	});

	// A previous RBAC run may have left permission overrides behind; resetting
	// them makes the suite deterministic without touching another tenant.
	await input.prisma.membershipPermission.deleteMany({
		where: { membershipId: { in: [farmerMembership.id, adminMembership.id] } },
	});

	const farm = await input.prisma.farm.upsert({
		where: { ownerId: farmer.farmId },
		update: { name: `${farmerLogin} farm` },
		create: { ownerId: farmer.farmId, name: `${farmerLogin} farm` },
	});

	const pond = await input.prisma.pond.upsert({
		where: { id: E2E_POND.id },
		update: {
			ownerId: farmer.farmId,
			farmId: farm.id,
			name: E2E_POND.name,
			feedingRatePct: 3,
			feedsPerDay: 3,
			population: 1000,
			scheduleStart: new Date("1970-01-01T06:00:00.000Z"),
			scheduleEnd: new Date("1970-01-01T18:00:00.000Z"),
			isFallow: false,
			status: "ACTIVE",
		},
		create: {
			id: E2E_POND.id,
			ownerId: farmer.farmId,
			farmId: farm.id,
			name: E2E_POND.name,
			feedingRatePct: 3,
			feedsPerDay: 3,
			population: 1000,
			scheduleStart: new Date("1970-01-01T06:00:00.000Z"),
			scheduleEnd: new Date("1970-01-01T18:00:00.000Z"),
			isFallow: false,
			status: "ACTIVE",
		},
	});

	// Reset the e2e device's own history so a rerun does not inherit a stale
	// pending request or an old sample.
	await input.prisma.scheduleCommand.deleteMany({ where: { pondId: pond.id } });
	const existingBiomassLogs = await input.prisma.biomassLog.findMany({
		where: { pondId: pond.id },
		select: { id: true },
	});
	if (existingBiomassLogs.length > 0) {
		const biomassLogIds = existingBiomassLogs.map((log) => log.id);
		await input.prisma.fishSample.deleteMany({
			where: { biomassLogId: { in: biomassLogIds } },
		});
		await input.prisma.biomassLog.deleteMany({ where: { id: { in: biomassLogIds } } });
	}
	await input.prisma.fcrReport.deleteMany({ where: { pondId: pond.id } });

	const existingDevice = await input.prisma.energyDevice.findUnique({
		where: { mac: E2E_DEVICE_MACS[0] },
		select: { id: true },
	});
	if (existingDevice) {
		await input.prisma.feedLevelLog.deleteMany({ where: { deviceId: existingDevice.id } });
		await input.prisma.feedRequest.deleteMany({ where: { deviceId: existingDevice.id } });
		await input.prisma.feedEvent.deleteMany({ where: { deviceId: existingDevice.id } });
		await input.prisma.deviceStateEvent.deleteMany({ where: { deviceId: existingDevice.id } });
	}

	const deviceToken = generateDeviceToken();
	const device = await input.prisma.energyDevice.upsert({
		where: { mac: E2E_DEVICE_MACS[0] },
		update: {
			token: deviceToken,
			tokenHash: hashDeviceToken(deviceToken),
			label: E2E_DEVICE_LABEL,
			pondId: pond.id,
			// A fake unit: never seen, so every feed attempt is refused offline.
			lastSeenAt: null,
			isPaused: false,
			gramsPerFeeding: 150,
			gramsPerSecond: 4,
			feedLevelPercent: null,
			feedLevelCm: null,
			feedLevelUpdatedAt: null,
			waterTempC: null,
			waterTempOk: false,
			waterTempUpdatedAt: null,
			hopperCapacityG: 7000,
		},
		create: {
			mac: E2E_DEVICE_MACS[0],
			token: deviceToken,
			tokenHash: hashDeviceToken(deviceToken),
			label: E2E_DEVICE_LABEL,
			pondId: pond.id,
			lastSeenAt: null,
			isPaused: false,
			gramsPerFeeding: 150,
			gramsPerSecond: 4,
			hopperCapacityG: 7000,
		},
	});

	const expiresAt = new Date(now.getTime() + E2E_PLATFORM_GRANT_HOURS * 60 * 60 * 1000);
	await input.prisma.platformAdmin.upsert({
		where: { userId: platformAdminUser.id },
		update: { expiresAt, revokedAt: null, grantedBy: "e2e-seed" },
		create: {
			userId: platformAdminUser.id,
			expiresAt,
			grantedBy: "e2e-seed",
		},
	});

	return {
		host: input.host,
		organization: { id: organization.id, name: organization.name },
		users: [
			{ farmId: farmer.farmId, role: farmer.role },
			{ farmId: admin.farmId, role: admin.role },
			{ farmId: platformAdminUser.farmId, role: platformAdminUser.role },
		],
		memberships: [
			{ farmId: farmer.farmId, orgId: organization.id, role: farmerMembership.role },
			{ farmId: admin.farmId, orgId: organization.id, role: adminMembership.role },
		],
		pond: { id: pond.id, name: pond.name, ownerFarmId: pond.ownerId },
		device: { mac: device.mac, label: device.label },
		platformAdmin: { farmId: platformAdminUser.farmId, expiresAt: expiresAt.toISOString() },
	};
}

function printSummary(summary: SeedSummary): void {
	console.log("");
	console.log("============================================");
	console.log("  E2E SEED — isolated e2e- fixtures only");
	console.log("============================================");
	console.log(`Target host:     ${summary.host}`);
	console.log(`Organization:    ${summary.organization.name} (${summary.organization.id})`);
	for (const user of summary.users) {
		console.log(`User:            ${user.farmId} (${user.role})`);
	}
	for (const membership of summary.memberships) {
		console.log(
			`Membership:      ${membership.farmId} -> ${membership.orgId} (${membership.role})`,
		);
	}
	console.log(`Pond:            ${summary.pond.name} (${summary.pond.id})`);
	console.log(`Device:          ${summary.device.label} (${summary.device.mac})`);
	console.log(`Platform admin:  ${summary.platformAdmin.farmId}`);
	console.log(`Grant expires:   ${summary.platformAdmin.expiresAt}`);
	console.log("");
	console.log("Passwords and device tokens are never printed.");
	console.log("Run scripts/e2e/cleanup-e2e.ts after the suite.");
	console.log("============================================");
}

async function main(): Promise<void> {
	try {
		loadEnvFile(".env");
	} catch {
		// .env may be absent; the ambient environment is used instead.
	}

	const { host } = assertE2eEnvironment();
	const password = requireE2ePassword();

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
		const summary = await seedE2e({ prisma, supabase, password, host });
		printSummary(summary);
	} finally {
		await prisma.$disconnect();
	}
}

if (isMainModule(import.meta.url)) {
	main().catch((error) => {
		console.error("[e2e seed] failed:", error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
