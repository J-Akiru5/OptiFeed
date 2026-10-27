import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import {
	E2E_DEVICE_LABEL,
	E2E_DEVICE_MACS,
	E2E_LOGIN_IDS,
	E2E_ORG,
	E2E_POND,
	assertE2eEnvironment,
	requireE2ePassword,
} from "../scripts/e2e/guards";

/**
 * Playwright global setup.
 *
 * Refuses to start unless:
 * - DATABASE_URL's host equals E2E_ALLOWED_DB_HOST,
 * - E2E_CONFIRM_PRODUCTION is the explicit acknowledgement,
 * - E2E_PASSWORD is set (the three e2e logins share it),
 * - the seeded e2e fixture actually exists.
 *
 * It never resets a password. The previous demo-account reset could change the
 * real demo user's password; the suite now uses only its own e2e- accounts and
 * fails with "run scripts/e2e/seed-e2e.ts first" when they are missing.
 */

const SEED_HINT =
	"Run scripts/e2e/seed-e2e.ts first (cd apps/web && pnpm exec tsx scripts/e2e/seed-e2e.ts).";

type AuthUser = { id: string; email?: string | null };

async function listAuthUsers(supabase: SupabaseClient): Promise<AuthUser[]> {
	const found: AuthUser[] = [];
	for (let page = 1; page <= 100; page++) {
		const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
		if (error) throw new Error(`[e2e] Could not list Supabase users: ${error.message}`);
		const users = data?.users ?? [];
		for (const user of users) {
			if (user.email) found.push({ id: user.id, email: user.email });
		}
		if (users.length < 200) break;
	}
	return found;
}

export default async function globalSetup(): Promise<void> {
	try {
		loadEnvFile(".env");
	} catch {
		// .env may be absent; the ambient environment is used instead.
	}

	const { host } = assertE2eEnvironment();
	requireE2ePassword();

	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !serviceRoleKey) {
		throw new Error(
			"[e2e] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to verify the e2e accounts.",
		);
	}

	const prisma = new PrismaClient();
	const supabase = createClient(url, serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false },
	});

	try {
		const loginIds = Object.values(E2E_LOGIN_IDS);
		const users = await prisma.user.findMany({
			where: { farmId: { in: [...loginIds] } },
			select: { id: true, farmId: true, supabaseId: true, mustChangePassword: true },
		});
		const missingUsers = loginIds.filter(
			(loginId) => !users.some((user) => user.farmId === loginId),
		);
		if (missingUsers.length > 0) {
			throw new Error(`[e2e] Missing e2e user rows: ${missingUsers.join(", ")}. ${SEED_HINT}`);
		}
		const usersNeedingPasswordChange = users.filter((user) => user.mustChangePassword);
		if (usersNeedingPasswordChange.length > 0) {
			throw new Error(
				`[e2e] ${usersNeedingPasswordChange.map((user) => user.farmId).join(", ")} is flagged for a password change. ${SEED_HINT}`,
			);
		}

		const organization = await prisma.organization.findUnique({
			where: { id: E2E_ORG.id },
			select: { id: true, status: true },
		});
		if (!organization || organization.status !== "ACTIVE") {
			throw new Error(`[e2e] Organization ${E2E_ORG.id} is missing or not ACTIVE. ${SEED_HINT}`);
		}

		const pond = await prisma.pond.findUnique({
			where: { id: E2E_POND.id },
			select: { id: true, ownerId: true, farmId: true },
		});
		if (!pond || pond.ownerId !== E2E_LOGIN_IDS.farmer) {
			throw new Error(
				`[e2e] Pond ${E2E_POND.id} is missing or not owned by the e2e farmer. ${SEED_HINT}`,
			);
		}

		const farmer = users.find((user) => user.farmId === E2E_LOGIN_IDS.farmer);
		const admin = users.find((user) => user.farmId === E2E_LOGIN_IDS.admin);
		const platform = users.find((user) => user.farmId === E2E_LOGIN_IDS.platform);
		if (!farmer || !admin || !platform) throw new Error(`[e2e] Incomplete e2e users. ${SEED_HINT}`);

		const device = await prisma.energyDevice.findFirst({
			where: {
				mac: E2E_DEVICE_MACS[0],
				label: E2E_DEVICE_LABEL,
				pondId: pond.id,
			},
			select: { id: true },
		});
		if (!device) {
			throw new Error(`[e2e] The e2e feeder ${E2E_DEVICE_MACS[0]} is missing. ${SEED_HINT}`);
		}

		const memberships = await prisma.membership.findMany({
			where: {
				orgId: organization.id,
				userId: { in: [farmer.id, admin.id] },
				revokedAt: null,
			},
			select: { userId: true, role: true },
		});
		const adminRole = memberships.find((row) => row.userId === admin.id)?.role;
		const farmerRole = memberships.find((row) => row.userId === farmer.id)?.role;
		if (adminRole !== "OWNER" || farmerRole !== "OPERATOR") {
			throw new Error(
				`[e2e] The e2e memberships are not seeded (admin=${adminRole ?? "none"}, farmer=${farmerRole ?? "none"}). ${SEED_HINT}`,
			);
		}

		const grant = await prisma.platformAdmin.findUnique({
			where: { userId: platform.id },
			select: { revokedAt: true, expiresAt: true },
		});
		if (
			!grant ||
			grant.revokedAt !== null ||
			!grant.expiresAt ||
			grant.expiresAt.getTime() <= Date.now()
		) {
			throw new Error(
				`[e2e] The temporary e2e platform-admin grant is missing or expired. ${SEED_HINT}`,
			);
		}

		const authUsers = await listAuthUsers(supabase);
		for (const user of users) {
			const email = `${user.farmId}@pond.optifeed.local`;
			const authUser = authUsers.find(
				(candidate) => candidate.email?.toLowerCase() === email.toLowerCase(),
			);
			if (!authUser || authUser.id !== user.supabaseId) {
				throw new Error(`[e2e] No matching Supabase auth account for ${email}. ${SEED_HINT}`);
			}
		}

		console.log(`[e2e] Fixture verified on ${host}; all e2e- accounts exist.`);
	} finally {
		await prisma.$disconnect();
	}
}
