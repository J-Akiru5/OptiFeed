"use server";

import { type MfaFactorLike, normalizeTotpCode } from "@/lib/auth/mfa-policy";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

/**
 * Self-service TOTP management for platform admins (#719).
 *
 * Supabase Auth stores the factor, the secret and the challenge state; this
 * module never writes any of them to the database. `PlatformAdmin.mfaEnrolledAt`
 * is updated purely so the platform console can report enrolment — it is not a
 * gate and a stale value can never lock an admin out.
 *
 * Every action starts with `requirePlatformAdmin()`, which also enforces a
 * completed MFA challenge, so a half-authenticated session cannot enrol,
 * confirm or remove a factor.
 */

export type TotpEnrollment = {
	/** Factor id returned by Supabase; needed to confirm or discard it. */
	factorId: string;
	/** The shared secret, shown once. Never logged, never stored. */
	secret: string;
	/** A `data:` URL for the SVG QR code. */
	qrCodeDataUrl: string;
};

export type BeginTotpEnrollmentResult = { enrollment: TotpEnrollment } | { error: "service" };

export type TotpActionResult = { success: true } | { error: "invalid" | "not_found" | "service" };

function isFactorId(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

/**
 * Supabase returns the QR as raw SVG markup in some versions and as a `data:`
 * URL in others. Normalise both into something an `<img>` can render.
 */
function toQrDataUrl(qrCode: string): string {
	if (qrCode.startsWith("data:")) return qrCode;
	return `data:image/svg+xml;utf-8,${encodeURIComponent(qrCode)}`;
}

async function updateEnrolledAt(userId: string, enrolled: boolean): Promise<void> {
	try {
		await prisma.platformAdmin.updateMany({
			where: { userId },
			data: { mfaEnrolledAt: enrolled ? new Date() : null },
		});
	} catch (error) {
		// Reporting only: the factor is already live in Supabase. A failed
		// timestamp must not turn a completed enrolment into an error.
		reportError(error, { action: "mfa.updateEnrolledAt" }, "WARNING");
	}
}

/** Factor ids are Supabase UUIDs; a client-posted value is untrusted. */
function findFactor<T extends MfaFactorLike>(
	factors: readonly T[] | null | undefined,
	factorId: string,
): T | null {
	return (factors ?? []).find((factor) => factor.id === factorId) ?? null;
}

/**
 * Start a TOTP enrolment: Supabase returns the secret and QR once.
 *
 * Any unverified TOTP factor left over from an abandoned attempt is discarded
 * first, so refreshing the page cannot pile up pending factors against the
 * project's per-user limit.
 */
export async function beginTotpEnrollment(): Promise<BeginTotpEnrollmentResult> {
	await requirePlatformAdmin();

	try {
		const user = await getCurrentUser();
		if (!user) return { error: "service" };

		const supabase = await createClient();

		const { data: existing } = await supabase.auth.mfa.listFactors();
		const pending = (existing?.all ?? []).filter(
			(factor) => factor.factor_type === "totp" && factor.status === "unverified",
		);
		for (const factor of pending) {
			// Unverified factors are not a second factor yet; removing one does
			// not change the account's protection. Ignore failures: the new
			// enrolment is still valid if a stale factor cannot be cleaned up.
			await supabase.auth.mfa.unenroll({ factorId: factor.id });
		}

		// GoTrue rejects a duplicate friendly name (`factor_name_conflict`), so a
		// second authenticator needs its own label. We do not render this name in
		// the app, but the Supabase dashboard does — keep it readable.
		const takenNames = new Set(
			(existing?.all ?? [])
				.map((factor) => factor.friendly_name)
				.filter((name): name is string => Boolean(name)),
		);
		let friendlyName = "OptiFeed authenticator";
		for (let suffix = 2; takenNames.has(friendlyName); suffix += 1) {
			friendlyName = `OptiFeed authenticator ${suffix}`;
		}

		const { data, error } = await supabase.auth.mfa.enroll({
			factorType: "totp",
			friendlyName,
			issuer: "OptiFeed",
		});
		if (error || !data || data.type !== "totp") {
			reportError(error ?? new Error("TOTP enrolment returned no factor"), {
				action: "mfa.beginEnrollment",
			});
			return { error: "service" };
		}

		// Do not log anything from `data.totp`: it is the shared secret.
		return {
			enrollment: {
				factorId: data.id,
				secret: data.totp.secret,
				qrCodeDataUrl: toQrDataUrl(data.totp.qr_code),
			},
		};
	} catch (error) {
		reportError(error, { action: "mfa.beginEnrollment" });
		return { error: "service" };
	}
}

/**
 * Confirm an enrolment with a code from the authenticator app.
 *
 * Verifying promotes this session to AAL2 and revokes the account's other
 * sessions (Supabase behaviour on first verification), which is the correct
 * response to a new factor being added.
 */
export async function confirmTotpEnrollment(
	factorId: string,
	code: string,
): Promise<TotpActionResult> {
	await requirePlatformAdmin();

	const normalizedCode = normalizeTotpCode(code);
	if (!isFactorId(factorId) || !normalizedCode) return { error: "invalid" };

	try {
		const user = await getCurrentUser();
		if (!user) return { error: "service" };

		const supabase = await createClient();
		const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
		if (listError) return { error: "service" };

		const factor = findFactor(factors?.all, factorId);
		if (!factor || factor.factor_type !== "totp") return { error: "not_found" };
		// Confirming an already-verified factor is a no-op, not a second factor.
		if (factor.status === "verified") return { success: true };

		const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
			factorId,
			code: normalizedCode,
		});
		if (verifyError) {
			console.error("[mfa] enrollment verification failed:", verifyError.message);
			return { error: "invalid" };
		}

		// `enrolled` is not a gate: if this write is lost the admin still has
		// the factor, and the login path reads Supabase, not this column.
		await updateEnrolledAt(user.id, true);
		return { success: true };
	} catch (error) {
		reportError(error, { action: "mfa.confirmEnrollment" });
		return { error: "service" };
	}
}

/**
 * Remove a verified TOTP factor. The caller must present a fresh code first:
 * `challengeAndVerify()` proves possession (and promotes the session to AAL2),
 * and only then does `unenroll()` run. A stolen AAL1 session cannot strip the
 * second factor, and a stolen AAL2 session still needs the device.
 */
export async function unenrollTotpFactor(
	factorId: string,
	code: string,
): Promise<TotpActionResult> {
	await requirePlatformAdmin();

	const normalizedCode = normalizeTotpCode(code);
	if (!isFactorId(factorId) || !normalizedCode) return { error: "invalid" };

	try {
		const user = await getCurrentUser();
		if (!user) return { error: "service" };

		const supabase = await createClient();
		const { data: before, error: listError } = await supabase.auth.mfa.listFactors();
		if (listError) return { error: "service" };

		const factor = findFactor(before?.all, factorId);
		if (!factor || factor.factor_type !== "totp") return { error: "not_found" };
		if (factor.status !== "verified") {
			// An unverified factor has no protection to remove; use discard.
			return { error: "invalid" };
		}

		const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
			factorId,
			code: normalizedCode,
		});
		if (verifyError) {
			console.error("[mfa] unenroll verification failed:", verifyError.message);
			return { error: "invalid" };
		}

		const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId });
		if (unenrollError) {
			reportError(unenrollError, { action: "mfa.unenroll" });
			return { error: "service" };
		}

		// Keep the reporting flag honest: clear it only when no verified factor
		// of any type remains. With another factor still active the timestamp is
		// left alone — removing one factor is not a new enrolment.
		const { data: after } = await supabase.auth.mfa.listFactors();
		const stillVerified = (after?.all ?? []).some((candidate) => candidate.status === "verified");
		if (!stillVerified) {
			await updateEnrolledAt(user.id, false);
		}

		return { success: true };
	} catch (error) {
		reportError(error, { action: "mfa.unenroll" });
		return { error: "service" };
	}
}

/**
 * Discard a pending (unverified) enrolment. No code is required because an
 * unverified factor is not a second factor: it cannot be challenged and grants
 * nothing. Verified factors are refused here and must go through
 * `unenrollTotpFactor()`.
 */
export async function cancelTotpEnrollment(factorId: string): Promise<TotpActionResult> {
	await requirePlatformAdmin();

	if (!isFactorId(factorId)) return { error: "invalid" };

	try {
		const supabase = await createClient();
		const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
		if (listError) return { error: "service" };

		const factor = findFactor(factors?.all, factorId);
		if (!factor || factor.factor_type !== "totp") return { error: "not_found" };
		if (factor.status === "verified") return { error: "invalid" };

		const { error } = await supabase.auth.mfa.unenroll({ factorId });
		if (error) {
			reportError(error, { action: "mfa.cancelEnrollment" });
			return { error: "service" };
		}
		return { success: true };
	} catch (error) {
		reportError(error, { action: "mfa.cancelEnrollment" });
		return { error: "service" };
	}
}
