import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

try {
	loadEnvFile(".env");
} catch {
	// .env may not exist; fall back to the ambient process environment.
}

const DEMO_EMAIL = "demo-farmer-1@pond.optifeed.local";
const DEMO_FARM_ID = "demo-farmer-1";
const DEMO_PIN = process.env.DEMO_PIN ?? "1234";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
	console.error(
		"Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run this from apps/web so .env is loaded.",
	);
	process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
	auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
	const { data: existing, error: listError } = await admin.auth.admin.listUsers();
	if (listError) throw listError;

	let user = existing.users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL);

	if (user) {
		// Password rotation is best-effort: Supabase may reject short demo
		// PINs (weak-password policy) even though the existing one works.
		// A failure here must not block the supabaseId link below.
		const { error } = await admin.auth.admin.updateUserById(user.id, { password: DEMO_PIN });
		if (error) {
			console.warn(`Could not reset PIN (existing one still valid): ${error.message}`);
		} else {
			console.log(`Updated PIN for existing demo user ${DEMO_EMAIL}.`);
		}
	} else {
		const { data, error } = await admin.auth.admin.createUser({
			email: DEMO_EMAIL,
			password: DEMO_PIN,
			email_confirm: true,
		});
		if (error) throw error;
		user = data.user;
		console.log(`Created demo user ${DEMO_EMAIL} (id=${data.user.id}).`);
	}

	// Link the Prisma User row to the REAL Supabase auth user id. The seeds
	// create the row with a placeholder supabaseId (CI has no Supabase), and
	// getCurrentUser() looks up by supabaseId — an unlinked row makes every
	// dashboard request redirect to /login, ping-ponging with the login
	// page's client-side skip (infinite login <-> dashboard loop).
	const prisma = new PrismaClient();
	try {
		const prismaUser = await prisma.user.findUnique({
			where: { farmId: DEMO_FARM_ID },
			select: { supabaseId: true },
		});
		if (!prismaUser) {
			console.warn(
				`No Prisma User row for ${DEMO_FARM_ID} — run the seed first, then re-run this script.`,
			);
		} else if (prismaUser.supabaseId !== user.id) {
			await prisma.user.update({
				where: { farmId: DEMO_FARM_ID },
				data: { supabaseId: user.id },
			});
			console.log(`Linked Prisma user ${DEMO_FARM_ID} to supabaseId ${user.id}.`);
		} else {
			console.log(`Prisma user ${DEMO_FARM_ID} already linked.`);
		}
	} finally {
		await prisma.$disconnect();
	}

	console.log(`Demo login -> Farm ID: demo-farmer-1, PIN: ${DEMO_PIN}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
