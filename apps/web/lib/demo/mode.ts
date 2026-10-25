const DEMO_FARM_ID = "demo-farmer-1";
const DEMO_EMAIL = `${DEMO_FARM_ID}@pond.optifeed.local`;
const DEFAULT_DEMO_SUPABASE_ID = "demo-supabase-user-001";

/**
 * Demo mode is a local-only escape hatch for the throwaway demo branch.
 * It refuses to activate on Vercel or in a production build so a deployed
 * build can never bypass authentication.
 */
export function isDemoMode(): boolean {
	return (
		process.env.DEMO_MODE === "1" &&
		!process.env.VERCEL_ENV &&
		process.env.NODE_ENV !== "production"
	);
}

export function demoSession(): { sub: string; email: string } {
	return {
		sub: process.env.DEMO_SUPABASE_ID ?? DEFAULT_DEMO_SUPABASE_ID,
		email: process.env.DEMO_EMAIL ?? DEMO_EMAIL,
	};
}
