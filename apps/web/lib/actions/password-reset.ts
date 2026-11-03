"use server";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { validatePassword } from "@/lib/auth/password";
import { parseClientIp } from "@/lib/client-ip";
import { parseResetIdentifier } from "@/lib/contact-email";
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
 * (see `lib/membership-invite.ts`). A recovery link therefore goes to the
 * account's separate `contactEmail` (#449): the address an administrator
 * records and the person types on the forgot-password page. A farm ID is still
 * accepted as the lookup key. An account with no contact email is not mailed
 * (no link is minted) and the answer stays the same. The flow:
 *
 *  - generates the recovery link in code (Supabase admin `generateLink`, for
 *    the login address) and sends it through Resend from the verified domain
 *    (issue #411) rather than relying on Supabase's own SMTP;
 *  - never discloses whether an account exists (anti-enumeration: unknown
 *    emails and farm IDs answer exactly like known ones);
 *  - never claims the email was delivered — the page tells the user to ask a
 *    platform administrator when the mailbox cannot be opened;
 *  - writes a PlatformAuditLog row for every request, so the superadmin audit
 *    explorer shows who asked for a reset, when, and whether the email went
 *    out. The link itself is never recorded;
 *  - leaves the CLI (`pnpm manage-user reset-password`) and the superadmin
 *    console reset as the reliable, audited path.
 *
 * The admin client is used for one narrow purpose — minting a recovery link
 * for the single login address the typed identifier resolves to. Authorization here is the
 * rate limiter plus the anti-enumeration contract, not RLS.
 */

/** Canonical production origin, used only when production has no override. */
const PRODUCTION_BASE_URL = "https://pakaonai.syntaxure.dev";

/**
 * Where the recovery link should send the visitor. `NEXT_PUBLIC_BASE_URL` wins
 * (the reminder/invite emails use the same override), then
 * `NEXT_PUBLIC_SITE_URL`. With neither set, only a production deployment may
 * fall back to the canonical origin; a preview or local build returns null so
 * the caller fails closed instead of mailing a production link from a
 * non-production surface (#732).
 */
export async function resolveAppBaseUrl(): Promise<string | null> {
	const configured =
		process.env.NEXT_PUBLIC_BASE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
	if (configured) return configured.replace(/\/+$/, "");
	return process.env.VERCEL_ENV === "production" ? PRODUCTION_BASE_URL : null;
}

// ---------------------------------------------------------------------------
// Recovery proof (#718)
//
// A Supabase recovery session alone is not proof that this browser consumed the
// emailed link: any authenticated session could otherwise set a permanent
// password without knowing the current one (CWE-620). The redirect carries a
// short-lived HMAC-SHA256 token whose `jti` is stored here and consumed
// atomically. The signing key is a dedicated sub-key of the existing
// SUPABASE_SERVICE_ROLE_KEY with a domain-separation label, mirroring
// lib/auth/step-up.ts; the raw key is never used as the HMAC key.
// ---------------------------------------------------------------------------

const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
const PASSWORD_RESET_TOKEN_MAX_LENGTH = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const HMAC_SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/;

type PasswordResetPayload = {
	userId: string;
	jti: string;
	exp: number;
};

type PasswordResetVerification =
	| { valid: true; jti: string; expiresAt: Date }
	| { valid: false; reason: "missing" | "expired" | "tampered" };

function requireResetSigningSecret(): string {
	const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!secret) {
		throw new Error(
			"Password-reset signing is unavailable: SUPABASE_SERVICE_ROLE_KEY is not set.",
		);
	}
	return secret;
}

/** A dedicated sub-key, so the raw service-role key is never the HMAC key. */
function resetSigningKey(): Buffer {
	return createHmac("sha256", requireResetSigningSecret())
		.update("optifeed:password-reset:v1")
		.digest();
}

function signResetPayload(encoded: string): string {
	return createHmac("sha256", resetSigningKey()).update(encoded).digest("base64url");
}

function mintPasswordResetProof(
	userId: string,
	now: Date = new Date(),
): { token: string; jti: string; expiresAt: Date } {
	const jti = randomUUID();
	const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
	const payload: PasswordResetPayload = { userId, jti, exp: expiresAt.getTime() };
	const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
	return { token: `${encoded}.${signResetPayload(encoded)}`, jti, expiresAt };
}

function parsePasswordResetPayload(encoded: string): PasswordResetPayload | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const candidate = parsed as Partial<PasswordResetPayload>;
	if (typeof candidate.userId !== "string" || candidate.userId.length === 0) return null;
	if (
		typeof candidate.jti !== "string" ||
		candidate.jti.length === 0 ||
		candidate.jti.length > 128
	) {
		return null;
	}
	if (typeof candidate.exp !== "number" || !Number.isFinite(candidate.exp)) return null;
	return { userId: candidate.userId, jti: candidate.jti, exp: candidate.exp };
}

/**
 * Verify a recovery proof for `userId`. Pure: no database access.
 *
 * Order matters: the signature is checked before any claim is trusted, then
 * the user binding, then expiry. A token minted for another account is
 * reported the same way as a forged one, so the caller cannot use it to probe
 * which account a token belongs to.
 */
function verifyPasswordResetProof(
	token: string | undefined | null,
	userId: string,
	now: Date = new Date(),
): PasswordResetVerification {
	if (!token) return { valid: false, reason: "missing" };
	if (token.length > PASSWORD_RESET_TOKEN_MAX_LENGTH) return { valid: false, reason: "tampered" };

	const parts = token.split(".");
	if (parts.length !== 2) return { valid: false, reason: "tampered" };
	const [encoded, signature] = parts;
	if (!encoded || !signature) return { valid: false, reason: "tampered" };
	// SHA-256 base64url is exactly 43 characters. Validate both parts so junk
	// characters cannot be silently ignored by a lenient base64 decoder.
	if (!BASE64URL.test(encoded) || !HMAC_SHA256_BASE64URL.test(signature)) {
		return { valid: false, reason: "tampered" };
	}

	const provided = Buffer.from(signature, "utf8");
	const expected = Buffer.from(signResetPayload(encoded), "utf8");
	if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
		return { valid: false, reason: "tampered" };
	}

	const payload = parsePasswordResetPayload(encoded);
	if (!payload) return { valid: false, reason: "tampered" };
	if (payload.userId !== userId) return { valid: false, reason: "tampered" };
	if (payload.exp <= now.getTime()) return { valid: false, reason: "expired" };

	return { valid: true, jti: payload.jti, expiresAt: new Date(payload.exp) };
}

/** Audit actor for requests that come from the public login page. */
const SELF_SERVICE_ACTOR = "self-service";
const REQUEST_REASON = "Self-service password reset requested from the login page.";

/** Request origin for the audit row (who/what/when/where), same as superadmin.ts. */
async function requestOrigin(): Promise<{ ip: string | null; userAgent: string | null }> {
	try {
		const h = await headers();
		return {
			ip: parseClientIp(h.get("x-forwarded-for")) ?? h.get("x-real-ip") ?? null,
			userAgent: h.get("user-agent")?.slice(0, 512) ?? null,
		};
	} catch {
		return { ip: null, userAgent: null };
	}
}

export type RequestPasswordResetResult =
	| { success: true }
	| { error: "invalid" | "rate_limited" | "service" };

/**
 * `identifier` is what the person typed: their contact email, or a login ID (a
 * bare farm ID, or the pond address the profile page used to show).
 */
export async function requestPasswordReset(
	identifier: string,
): Promise<RequestPasswordResetResult> {
	try {
		const parsed = parseResetIdentifier(identifier);
		// Reject obvious garbage before touching the store.
		if (!parsed) return { error: "invalid" };

		const ip = await getClientIp();
		const { success } = await checkPasswordResetRateLimit(ip);
		if (!success) return { error: "rate_limited" };

		const user = await prisma.user.findUnique({
			where: parsed.kind === "email" ? { contactEmail: parsed.value } : { farmId: parsed.value },
			select: { id: true, email: true, farmId: true, contactEmail: true },
		});
		// Identical answer for an unknown account: the caller learns nothing.
		if (!user) return { success: true };

		const locale = await getLocale();
		const appBaseUrl = user.contactEmail ? await resolveAppBaseUrl() : null;

		// Mint the recovery link in code, then hand delivery to Resend. An account
		// with no contact email has nowhere to send it, so nothing is minted. A
		// non-production deployment without a base URL also fails closed: no
		// proof, no link and no email, but the caller still gets the same answer.
		let emailSent = false;
		let notSentReason:
			| "no_contact_email"
			| "base_url_unconfigured"
			| "proof_unavailable"
			| undefined;
		if (!user.contactEmail) {
			notSentReason = "no_contact_email";
		} else if (!appBaseUrl) {
			notSentReason = "base_url_unconfigured";
			reportError(
				new Error(
					"Password-reset base URL is not configured; no recovery link was minted.",
				),
				{ action: "requestPasswordReset.baseUrl", farmId: user.farmId },
			);
		} else {
			try {
				const proof = mintPasswordResetProof(user.id);
				await prisma.passwordResetToken.create({
					data: { jti: proof.jti, userId: user.id, expiresAt: proof.expiresAt },
				});
				const redirectTo =
					`${appBaseUrl}/${locale}/reset-password?reset=${encodeURIComponent(proof.token)}`;

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
						farmId: user.farmId,
					});
				} else {
					emailSent = await deliverPasswordResetEmail({
						to: user.contactEmail,
						farmId: user.farmId,
						resetUrl: actionLink,
					});
				}
			} catch (error) {
				// Keep the anti-enumeration answer even when signing or persistence
				// fails: the caller must not learn that the account exists.
				notSentReason = "proof_unavailable";
				reportError(error, {
					action: "requestPasswordReset.proof",
					farmId: user.farmId,
				});
			}
		}

		// The superadmin audit log records the request itself — actor, target,
		// time, origin and whether the email went out. The link and the recovery
		// proof are credentials and are deliberately absent from every column.
		const origin = await requestOrigin();
		const auditRow: Prisma.PlatformAuditLogUncheckedCreateInput = {
			actorUserId: SELF_SERVICE_ACTOR,
			action: "platform.user.password_reset_requested",
			targetType: "user",
			targetId: user.id,
			reason: REQUEST_REASON,
			ip: origin.ip,
			userAgent: origin.userAgent,
			after: {
				farmId: user.farmId,
				via: parsed.kind,
				emailSent,
				...(notSentReason ? { reason: notSentReason } : {}),
			},
		};
		await prisma.platformAuditLog
			.create({ data: auditRow })
			.catch((auditError: unknown) =>
				reportError(auditError, { action: "requestPasswordReset.audit" }),
			);

		return { success: true };
	} catch (error) {
		// The typed identifier may be an email address, so it is not logged.
		reportError(error, { action: "requestPasswordReset" });
		return { error: "service" };
	}
}

export type CompletePasswordResetResult =
	| { success: true }
	| { error: "session" | "reset_link" | "mismatch" | "weak_password" | "service" };

/**
 * Set the new password from the recovery link's session.
 *
 * The caller arrives at /reset-password with a Supabase recovery session (the
 * email link established it), so the current password is neither known nor
 * asked for. That session alone is not authorization: the redirect also carries
 * the signed, single-use proof minted by `requestPasswordReset`, and this
 * action consumes it atomically before calling `updateUser`. A normal
 * authenticated session, a forged token and a replay all return `reset_link`
 * without touching the password (#718). The flag is cleared so the next
 * sign-in lands on the normal console instead of bouncing to /change-password.
 *
 * If Supabase fails after the proof was consumed, the proof stays burned and a
 * new link is required. That is deliberate: restoring it on failure would make
 * the "single-use" guarantee depend on a downstream error.
 */
export async function completePasswordReset(input: {
	newPassword: string;
	confirmPassword: string;
	resetToken?: string;
}): Promise<CompletePasswordResetResult> {
	try {
		const supabase = await createClient();
		const {
			data: { user: authUser },
		} = await supabase.auth.getUser();
		if (!authUser) return { error: "session" };

		// A missing proof is the ordinary authenticated-session case: reject
		// before validating or updating anything.
		if (typeof input.resetToken !== "string" || input.resetToken.length === 0) {
			return { error: "reset_link" };
		}

		if (input.newPassword !== input.confirmPassword) return { error: "mismatch" };

		const validation = validatePassword(input.newPassword, "permanent");
		if (!validation.ok) return { error: "weak_password" };

		// Bind the proof to the application user behind this session, not just
		// to "some session". The proof carries User.id, never a password.
		const localUser = await prisma.user.findUnique({
			where: { supabaseId: authUser.id },
			select: { id: true },
		});
		if (!localUser) return { error: "reset_link" };

		const proof = verifyPasswordResetProof(input.resetToken, localUser.id);
		if (!proof.valid) return { error: "reset_link" };

		// Atomic single-use claim: only one caller can flip consumedAt from null.
		// The expiry is re-checked here so a clock skew between token and row
		// cannot extend the proof's life.
		const now = new Date();
		const consumed = await prisma.passwordResetToken.updateMany({
			where: {
				jti: proof.jti,
				userId: localUser.id,
				consumedAt: null,
				expiresAt: { gt: now },
			},
			data: { consumedAt: now },
		});
		if (consumed.count !== 1) return { error: "reset_link" };

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
