import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const DEMO_EMAIL = "demo-farmer-1@pond.optifeed.local";
const DEMO_FARM_ID = "demo-farmer-1";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "OptiFeedDemo123";

/**
 * Playwright global setup — gap #7.
 *
 * Refuses to run the e2e suite unless the DATABASE_URL host matches the
 * allow-listed host in E2E_ALLOWED_DB_HOST. This makes it impossible for
 * `pnpm test:e2e` to run destructive flows against production.
 *
 * Both env vars are required: without an explicit allow-list the suite
 * simply does not run.
 *
 * It also stabilizes the demo account: the password rollout may leave it
 * flagged for a forced change, which would break every UI login test. The
 * reset is idempotent and only touches the demo account.
 */
export default async function globalSetup(): Promise<void> {
	const databaseUrl = process.env.DATABASE_URL;
	const allowedHost = process.env.E2E_ALLOWED_DB_HOST;

	if (!databaseUrl) {
		throw new Error(
			"e2e blocked: DATABASE_URL is not set. Set DATABASE_URL and E2E_ALLOWED_DB_HOST to run e2e tests.",
		);
	}
	if (!allowedHost) {
		throw new Error(
			"e2e blocked: E2E_ALLOWED_DB_HOST is not set. Set it to the dev database host to run e2e tests.",
		);
	}

	const host = new URL(databaseUrl).hostname;
	if (host !== allowedHost) {
		throw new Error(
			`e2e blocked: DATABASE_URL host "${host}" is not the allow-listed host "${allowedHost}". E2E tests may only run against the dev database.`,
		);
	}

	await ensureDemoPassword();
}

async function ensureDemoPassword(): Promise<void> {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!url || !serviceRoleKey) {
		console.warn(
			"[e2e] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing; skipping the demo password reset.",
		);
		return;
	}

	const admin = createClient(url, serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false },
	});

	const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
	if (error) {
		throw new Error(`[e2e] Could not list Supabase users: ${error.message}`);
	}

	const demo = data.users.find((user) => user.email?.toLowerCase() === DEMO_EMAIL);
	if (!demo) {
		throw new Error(`[e2e] No Supabase Auth user exists for ${DEMO_EMAIL}. Run the seed first.`);
	}

	const { error: updateError } = await admin.auth.admin.updateUserById(demo.id, {
		password: DEMO_PASSWORD,
	});
	if (updateError) {
		throw new Error(`[e2e] Could not reset the demo password: ${updateError.message}`);
	}

	const prisma = new PrismaClient();
	try {
		await prisma.user.update({
			where: { farmId: DEMO_FARM_ID },
			data: { supabaseId: demo.id, mustChangePassword: false },
		});
	} finally {
		await prisma.$disconnect();
	}

	console.log(`[e2e] Demo account ${DEMO_FARM_ID} is stable with the configured DEMO_PASSWORD.`);
}
