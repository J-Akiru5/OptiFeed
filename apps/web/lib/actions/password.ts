"use server";

import { validatePassword } from "@/lib/auth/password";
import { isPlatformAdminActive } from "@/lib/auth/platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export type ChangePasswordResult =
	| { success: true; redirectTo: "/dashboard" | "/superadmin" }
	| { error: "wrong_current" | "weak_password" | "same_password" | "service" };

export async function changeOwnPassword(input: {
	currentPassword: string;
	newPassword: string;
}): Promise<ChangePasswordResult> {
	try {
		const user = await getCurrentUser();
		if (!user) return { error: "service" };
		if (!input.currentPassword) return { error: "wrong_current" };
		if (input.currentPassword === input.newPassword) return { error: "same_password" };

		const validation = validatePassword(input.newPassword, "permanent");
		if (!validation.ok) return { error: "weak_password" };

		const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
		const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
		if (!url || !anonKey) return { error: "service" };

		// Verify the current password on a throwaway client so the real session
		// cookies are not rotated just to check a credential.
		const verifier = createSupabaseClient(url, anonKey, {
			auth: { autoRefreshToken: false, persistSession: false },
		});
		const { error: verifyError } = await verifier.auth.signInWithPassword({
			email: user.email,
			password: input.currentPassword,
		});
		if (verifyError) return { error: "wrong_current" };

		const supabase = await createClient();
		const { error: updateError } = await supabase.auth.updateUser({
			password: input.newPassword,
		});

		if (updateError) {
			// Supabase projects with "secure password change" enabled require a
			// recent reauthentication. The current password was already checked
			// above, so the admin API is a safe fallback.
			const needsReauth =
				updateError.code === "reauthentication_needed" ||
				updateError.message.toLowerCase().includes("reauthentication");
			if (!needsReauth) {
				reportError(updateError, { action: "changeOwnPassword.update" });
				return { error: "service" };
			}

			const admin = createAdminClient();
			const { error: adminError } = await admin.auth.admin.updateUserById(user.supabaseId, {
				password: input.newPassword,
			});
			if (adminError) {
				reportError(adminError, { action: "changeOwnPassword.adminUpdate" });
				return { error: "service" };
			}
		}

		await prisma.user.update({
			where: { id: user.id },
			data: { mustChangePassword: false },
		});

		// Best-effort: keep the current session, revoke the rest.
		await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);

		const adminRow = await prisma.platformAdmin.findUnique({
			where: { userId: user.id },
			select: { revokedAt: true, expiresAt: true },
		});
		const redirectTo = adminRow && isPlatformAdminActive(adminRow) ? "/superadmin" : "/dashboard";

		return { success: true, redirectTo };
	} catch (error) {
		reportError(error, { action: "changeOwnPassword" });
		return { error: "service" };
	}
}
