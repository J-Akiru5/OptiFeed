import { createBrowserClient } from "@supabase/ssr";

// TODO(karl): Wire this client into auth forms, session recovery, and any client-side data fetching.
export function createClient() {
	return createBrowserClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL || "",
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
	);
}
