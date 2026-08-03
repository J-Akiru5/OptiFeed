import { redirect } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "next-intl/server";

const POND_EMAIL_DOMAIN = "pond.optifeed.local";

export function buildPondEmail(farmId: string): string {
	return `${farmId.toLowerCase().trim()}@${POND_EMAIL_DOMAIN}`;
}

export function farmIdFromEmail(email: string | undefined | null): string | null {
	if (!email) return null;
	const local = email.split("@")[0];
	if (!local) return null;
	return local.toLowerCase();
}

export async function getCurrentPondOwnerId(): Promise<string> {
	const locale = await getLocale();
	const supabase = await createClient();

	const {
		data: { user },
	} = await supabase.auth.getUser();

	const ownerId = user?.email ? farmIdFromEmail(user.email) : null;

	if (!ownerId) {
		redirect({ href: "/login", locale });
		return ""; // unreachable — redirect aborts the request
	}

	return ownerId;
}

export async function getCurrentPondOwnerIdSafe(): Promise<string | null> {
	const supabase = await createClient();

	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user) return null;
	return farmIdFromEmail(user.email);
}
