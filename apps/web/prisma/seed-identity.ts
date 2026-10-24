import { createClient } from "@supabase/supabase-js";

const POND_EMAIL_DOMAIN = "pond.optifeed.local";

export function buildSeedEmail(farmId: string): string {
	return `${farmId.toLowerCase().trim()}@${POND_EMAIL_DOMAIN}`;
}

export interface SeedIdentity {
	email: string;
	/** Explicit override for environments without a service role key. */
	supabaseId?: string;
}

/**
 * Resolve the Supabase Auth user id that owns a farm-provisioned email.
 *
 * `User.supabaseId` must equal the session subject: `getCurrentUser()` looks
 * the row up by `supabaseId` and returns null on a mismatch, which used to
 * bounce /dashboard back to /login on every request. Seeding therefore never
 * invents this id — it either reads it from Supabase Auth or fails loudly.
 */
export async function resolveSupabaseUserId({ email, supabaseId }: SeedIdentity): Promise<string> {
	if (supabaseId) return supabaseId;

	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!url || !serviceRoleKey) {
		throw new Error(
			`Cannot resolve the Supabase Auth user for ${email}: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass an explicit id). Seeding must not guess User.supabaseId — a mismatch makes the account impossible to sign in to.`,
		);
	}

	const admin = createClient(url, serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false },
	});

	const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
	if (error) {
		throw new Error(`Supabase Auth lookup failed for ${email}: ${error.message}`);
	}

	const user = data.users.find(
		(candidate) => candidate.email?.toLowerCase() === email.toLowerCase(),
	);

	if (!user) {
		throw new Error(
			`No Supabase Auth user exists for ${email}. Provision it first (pnpm --filter web manage-user create --farm-id <farm> ...), then re-run the seed.`,
		);
	}

	return user.id;
}
