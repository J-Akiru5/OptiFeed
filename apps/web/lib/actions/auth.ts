"use server";

import { redirect } from "@/i18n/routing";
import { buildPondEmail } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "next-intl/server";

export type LoginResult = { error: "invalid" } | undefined;

export async function loginWithPin(farmId: string, pin: string): Promise<LoginResult> {
	if (!farmId.trim()) return { error: "invalid" };
	if (pin.length < 4 || pin.length > 6) return { error: "invalid" };

	const locale = await getLocale();
	const supabase = await createClient();

	const { error } = await supabase.auth.signInWithPassword({
		email: buildPondEmail(farmId),
		password: pin,
	});

	if (error) {
		console.error("[auth] login failed:", error.message);
		return { error: "invalid" };
	}

	redirect({ href: "/dashboard", locale });
}
