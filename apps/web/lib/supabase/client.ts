import { createBrowserClient } from "@supabase/ssr";
import { sessionCookieOptions } from "./cookie-options";

// Browser-side Supabase client: used by auth forms, session recovery, and
// client-side data fetching. The cookie options must match the server client
// (#717): whichever client refreshes the session last writes the cookie, so a
// mismatch would let one client reintroduce the 400-day default.
export function createClient() {
	return createBrowserClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL || "",
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
		{ cookieOptions: sessionCookieOptions(process.env.NODE_ENV === "production") },
	);
}
