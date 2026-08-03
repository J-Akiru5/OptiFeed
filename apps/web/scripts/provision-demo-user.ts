import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";

try {
	loadEnvFile(".env");
} catch {
	// .env may not exist; fall back to the ambient process environment.
}

const DEMO_EMAIL = "demo-farmer-1@pond.optifeed.local";
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

	const user = existing.users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL);

	if (user) {
		const { error } = await admin.auth.admin.updateUserById(user.id, { password: DEMO_PIN });
		if (error) throw error;
		console.log(`Updated PIN for existing demo user ${DEMO_EMAIL}.`);
	} else {
		const { data, error } = await admin.auth.admin.createUser({
			email: DEMO_EMAIL,
			password: DEMO_PIN,
			email_confirm: true,
		});
		if (error) throw error;
		console.log(`Created demo user ${DEMO_EMAIL} (id=${data.user.id}).`);
	}

	console.log(`Demo login -> Farm ID: demo-farmer-1, PIN: ${DEMO_PIN}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
