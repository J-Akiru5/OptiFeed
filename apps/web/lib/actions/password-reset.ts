"use server";

import { validatePassword } from "@/lib/auth/password";
import { deliverPasswordResetEmail } from "@/lib/notify/reset-email";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import { checkPasswordResetRateLimit, getClientIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Prisma } from "@prisma/client";
import { getLocale } from "next-intl/server";
import { headers } from "next/headers";

/**
 * Self-service password recovery (login → forgot password → Resend email →
 * /reset-password), plus the admin-driven reset in
 * `lib/actions/superadmin.ts` for accounts whose mailbox cannot be reached.
 *
 * The constraint that shapes this file: every login address is a synthetic
 * `<login-id>@pond.optifeed.local` and is never a deliverable mailbox
 * (see `lib/membership-invite.ts`). The flow therefore:
 *
 *  - generates the recovery link in code (Supabase admin `generateLink`) and
 *    sends it through Resend from the verified domain (issue #411) rather than
 *    relying on Supabase's own SMTP;
 *  - never discloses whether a farm ID exists (anti-enumeration: unknown ids
 *    answer exactly like known ones);
 *  - never claims the email was delivered — the page tells the user to ask a
 *    platform administrator when the mailbox cannot be opened;
 *  - writes a PlatformAuditLog row for every request, so the superadmin audit
 *    explorer shows who asked for a reset, when, and whether the email went
 *    out. The link itself is never recorded;
 *  - leaves the CLI (`pnpm manage-user reset-password`) and the superadmin
 *    console reset as the reliable, audited path.
 *
 * The admin client is used for one narrow purpose — minting a recovery link
 * for the single address the farm ID resolves to. Authorization here is the
 * rate limiter plus the anti-enumeration contract, not RLS.
 */

// Mirrors the canonical site URL in app/[locale]/layout.tsx, overridable so a
// preview deployment can point the recovery link at itself. NEXT_PUBLIC_BASE_URL
// is the same base the reminder/invite emails use.
const BASE_URL = (
	process.env.NEXT_PUBLIC_BASE_URL ??
	process.env.NEXT_PUBLIC_SITE_URL ??
	"https://pakaonai.syntaxure.dev"
).replace(/\/+$/, "");

/** Audit actor for requests that come from the public login page. */
const SELF_SERVICE_ACTOR = "self-service";
const REQUEST_REASON = "Self-service password reset requested from the login page.";

/** Request origin for the audit row (who/what/when/where), same as superadmin.ts. */
async function requestOrigin(): Promise<{ ip: string | null; userAgent: string | null }> {
	try {
		const h = await headers();
		const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
		return {
			ip: forwarded || h.get("x-real-ip") || null,
			userAgent: h.get("user-agent")?.slice(0, 512) ?? null,
		};
	} catch {
		return { ip: null, userAgent: null };
	}
}

export type RequestPasswordResetResult =
	| { success: true }
	| { error: "invalid" | "rate_limited" | "service" };

export async function requestPasswordReset(farmId: string): Promise<RequestPasswordResetResult> {
	try {
		const normalizedFarmId = typeof farmId === "string" ? farmId.trim().toLowerCase() : "";
		// Same shape as login: reject obvious garbage before touching the store.
		if (!normalizedFarmId || normalizedFarmId.length > 64) return { error: "invalid" };

		const ip = await getClientIp();
		const { success } = await checkPasswordResetRateLimit(ip);
		if (!success) return { error: "rate_limited" };

		const user = await prisma.user.findUnique({
			where: { farmId: normalizedFarmId },
			select: { id: true, email: true },
		});
		// Identical answer for an unknown farm ID: the caller learns nothing.
		if (!user) return { success: true };

		const locale = await getLocale();
		const redirectTo = `${BASE_URL}/${locale}/reset-password`;

		// Mint the recovery link in code, then hand delivery to Resend.
		let emailSent = false;
		const admin = createAdminClient();
		const { data, error } = await admin.auth.admin.generateLink({
			type: "recovery",
			email: user.email,
			options: { redirectTo },
		});
		// supabase-js returns the link under `properties` (GenerateLinkResponse).
		const actionLink = data?.properties?.action_link;
		if (error || !actionLink) {
			reportError(error ?? new Error("no action_link returned"), {
				action: "requestPasswordReset.generateLink",
				farmId: normalizedFarmId,
			});
		} else {
			emailSent = await deliverPasswordResetEmail({
				to: user.email,
				farmId: normalizedFarmId,
				resetUrl: actionLink,
			});
		}

		// The superadmin audit log records the request itself — actor, target,
		// time, origin and whether the email went out. The link is a credential
		// and is deliberately absent from every column.
		const origin = await requestOrigin();
		const auditRow: Prisma.PlatformAuditLogUncheckedCreateInput = {
			actorUserId: SELF_SERVICE_ACTOR,
			action: "platform.user.password_reset_requested",
			targetType: "user",
			targetId: user.id,
			reason: REQUEST_REASON,
			ip: origin.ip,
			userAgent: origin.userAgent,
			after: { farmId: normalizedFarmId, emailSent },
		};
		await prisma.platformAuditLog
			.create({ data: auditRow })
			.catch((auditError: unknown) =>
				reportError(auditError, { action: "requestPasswordReset.audit" }),
			);

		return { success: true };
	} catch (error) {
		reportError(error, { action: "requestPasswordReset", farmId });
		return { error: "service" };
	}
}

export type CompletePasswordResetResult =
	| { success: true }
	| { error: "session" | "mismatch" | "weak_password" | "service" };

/**
 * Set the new password from the recovery link's session.
 *
 * The caller arrives at /reset-password with a Supabase recovery session
 * (the email link established it), so the current password is neither known
 * nor asked for. The flag is cleared so the next sign-in lands on the normal
 * console instead of bouncing to /change-password.
 */
export async function completePasswordReset(input: {
	newPassword: string;
	confirmPassword: string;
}): Promise<CompletePasswordResetResult> {
	try {
		const supabase = await createClient();
		const {
			data: { user: authUser },
		} = await supabase.auth.getUser();
		if (!authUser) return { error: "session" };

		if (input.newPassword !== input.confirmPassword) return { error: "mismatch" };

		const validation = validatePassword(input.newPassword, "permanent");
		if (!validation.ok) return { error: "weak_password" };

		const { error: updateError } = await supabase.auth.updateUser({
			password: input.newPassword,
		});
		if (updateError) {
			reportError(updateError, { action: "completePasswordReset.update" });
			return { error: "service" };
		}

		// The user row is keyed by the session subject, the same lookup
		// getCurrentUser() uses.
		await prisma.user.updateMany({
			where: { supabaseId: authUser.id },
			data: { mustChangePassword: false },
		});

		// Best-effort: keep the recovery session, revoke the rest.
		await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);

		return { success: true };
	} catch (error) {
		reportError(error, { action: "completePasswordReset" });
		return { error: "service" };
	}
}
