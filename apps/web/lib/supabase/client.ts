import { createBrowserClient } from "@supabase/ssr";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing environment variable: ${name}`);
	}
	return value;
}

// TODO(karl): Wire this client into auth forms, session recovery, and any client-side data fetching.
export function createClient() {
	return createBrowserClient(
		requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
		requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
	);
}
