import { createServerClient } from "@supabase/ssr";
import type { SetAllCookies } from "@supabase/ssr";
import { cookies } from "next/headers";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing environment variable: ${name}`);
	}
	return value;
}

// TODO(karl): Use this server client in Server Components, Server Actions, and Route Handlers that need an authenticated Supabase session.
export async function createClient() {
	const cookieStore = await cookies();

	return createServerClient(
		requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
		requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
		{
			cookies: {
				getAll() {
					return cookieStore.getAll();
				},
				setAll: ((cookiesToSet) => {
					try {
						for (const { name, value, options } of cookiesToSet) {
							cookieStore.set(name, value, options);
						}
					} catch {
						// The `setAll` method may fail if called from a Server Component.
						// This can be ignored if you have middleware refreshing sessions.
					}
				}) as SetAllCookies,
			},
		},
	);
}
