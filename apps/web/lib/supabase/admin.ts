import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing environment variable: ${name}`);
	}
	return value;
}

/**
 * Supabase client for the Admin API (`auth.admin.createUser`, `deleteUser`,
 * `updateUserById`, `listUsers`).
 *
 * Those endpoints require the service_role key. The session client in
 * `lib/supabase/server.ts` is built from NEXT_PUBLIC_SUPABASE_ANON_KEY and is
 * rejected with 403 "User not allowed" if it is used here — which is exactly
 * how every UI path that creates or deletes a login used to fail.
 *
 * Never import this from a client component: the key is not NEXT_PUBLIC_-prefixed,
 * so Next does not inline it, and requireEnv throws at runtime where it is absent.
 * Callers must gate on requireRole("ADMIN") / requirePlatformAdmin() first —
 * service_role bypasses RLS, so authorization lives entirely at the app layer.
 */
export function createAdminClient() {
	return createClient(
		requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
		requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
		{ auth: { autoRefreshToken: false, persistSession: false } },
	);
}
