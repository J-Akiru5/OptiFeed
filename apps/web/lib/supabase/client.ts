import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client: used by auth forms, session recovery, and
// client-side data fetching.
export function createClient() {
	return createBrowserClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL || "",
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
	);
}
