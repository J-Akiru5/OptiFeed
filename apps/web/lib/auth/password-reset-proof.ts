import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import prisma from "@/lib/prisma";

/**
 * Single-use password-reset proof (#718).
 *
 * A Supabase recovery session alone is not proof that this browser consumed the
 * emailed link: any authenticated session could otherwise set a permanent
 * password without knowing the current one (CWE-620). The redirect carries a
 * short-lived HMAC-SHA256 token whose `jti` is stored here and consumed
 * atomically. The signing key is a dedicated sub-key of the existing
 * SUPABASE_SERVICE_ROLE_KEY with a domain-separation label, mirroring
 * lib/auth/step-up.ts; the raw key is never used as the HMAC key.
 */

const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
const PASSWORD_RESET_TOKEN_MAX_LENGTH = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const HMAC_SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/;

type PasswordResetPayload = {
	userId: string;
	jti: string;
	exp: number;
};

export type PasswordResetVerification =
	| { valid: true; jti: string; expiresAt: Date }
	| { valid: false; reason: "missing" | "expired" | "tampered" };

function requireResetSigningSecret(): string {
	const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!secret) {
		throw new Error("Password-reset signing is unavailable: SUPABASE_SERVICE_ROLE_KEY is not set.");
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

/** Mint a proof without persisting it. Exported for tests and the persistence wrapper. */
export function mintPasswordResetProof(
	userId: string,
	now: Date = new Date(),
): { token: string; jti: string; expiresAt: Date } {
	const jti = randomUUID();
	const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
	const payload: PasswordResetPayload = { userId, jti, exp: expiresAt.getTime() };
	const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
	return { token: `${encoded}.${signResetPayload(encoded)}`, jti, expiresAt };
}

/**
 * Mint and persist a proof for `userId`. Both the self-service and the
 * platform-admin reset flows use this so `completePasswordReset` can consume
 * the same single-use row (#718).
 */
export async function issuePasswordResetProof(
	userId: string,
	now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
	const proof = mintPasswordResetProof(userId, now);
	await prisma.passwordResetToken.create({
		data: { jti: proof.jti, userId, expiresAt: proof.expiresAt },
	});
	return { token: proof.token, expiresAt: proof.expiresAt };
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
export function verifyPasswordResetProof(
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
