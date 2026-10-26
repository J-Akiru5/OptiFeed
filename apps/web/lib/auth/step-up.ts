import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getCurrentUser } from "./session";

/**
 * Step-up re-authentication (plan M3.2/M3.3).
 *
 * A dangerous platform action must be preceded by the admin re-entering their
 * own password. Success sets a short-lived, signed, httpOnly cookie; the
 * mutation then proves freshness with `withStepUp()` and records the
 * verification time as `PlatformAuditLog.stepUpAt`.
 *
 * The cookie is a bearer credential for "this password was checked recently",
 * so it is signed (HMAC-SHA256) and never carries the password or a session
 * token. The signing key is derived from the existing server-only
 * SUPABASE_SERVICE_ROLE_KEY with a domain-separation label, so no new
 * environment variable is required and the raw key is not reused directly.
 *
 * Fail-closed: a missing, expired, tampered, or other-user cookie is rejected.
 */

export const STEP_UP_COOKIE = "stepup";
export const STEP_UP_TTL_MS = 5 * 60 * 1000;
export const STEP_UP_REQUIRED_CODE = "step_up_required";

export type StepUpFailureReason = "unauthenticated" | "missing" | "expired" | "tampered";

export type StepUpState =
	| { active: true; stepUpAt: Date }
	| { active: false; stepUpAt: null; reason: StepUpFailureReason };

type StepUpPayload = {
	userId: string;
	issuedAt: number;
	expiresAt: number;
};

const FAILURE_MESSAGES: Record<StepUpFailureReason, string> = {
	unauthenticated: "Not authenticated.",
	missing: "Re-enter your password to continue. This action needs a fresh 5-minute check.",
	expired: "Your step-up check expired. Re-enter your password to continue.",
	tampered: "Your step-up check is invalid. Re-enter your password to continue.",
};

export class StepUpRequiredError extends Error {
	readonly code = STEP_UP_REQUIRED_CODE;
	readonly reason: StepUpFailureReason;

	constructor(reason: StepUpFailureReason) {
		super(FAILURE_MESSAGES[reason]);
		this.name = "StepUpRequiredError";
		this.reason = reason;
	}
}

/**
 * Duck-typed so a caller keeps working when the error crossed a module
 * boundary (or a test double) and `instanceof` cannot match.
 */
export function isStepUpRequiredError(
	error: unknown,
): error is { code: typeof STEP_UP_REQUIRED_CODE; message: string } {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === STEP_UP_REQUIRED_CODE
	);
}

function requireSigningSecret(): string {
	const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!secret) {
		throw new Error("Step-up signing is unavailable: SUPABASE_SERVICE_ROLE_KEY is not set.");
	}
	return secret;
}

/** A dedicated sub-key, so the raw service-role key is never the HMAC key. */
function signingKey(): Buffer {
	return createHmac("sha256", requireSigningSecret()).update("optifeed:stepup:v1").digest();
}

function sign(payload: string): string {
	return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

/** Create a signed step-up token for `userId`. Exported for tests and the action. */
export function createStepUpToken(userId: string, now: Date = new Date()): string {
	const issuedAt = now.getTime();
	const payload: StepUpPayload = {
		userId,
		issuedAt,
		expiresAt: issuedAt + STEP_UP_TTL_MS,
	};
	const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
	return `${encoded}.${sign(encoded)}`;
}

export type StepUpVerification =
	| { valid: true; stepUpAt: Date }
	| { valid: false; reason: StepUpFailureReason };

function parsePayload(encoded: string): StepUpPayload | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const candidate = parsed as Partial<StepUpPayload>;
	if (typeof candidate.userId !== "string" || candidate.userId.length === 0) return null;
	if (typeof candidate.issuedAt !== "number" || !Number.isFinite(candidate.issuedAt)) return null;
	if (typeof candidate.expiresAt !== "number" || !Number.isFinite(candidate.expiresAt)) return null;
	return {
		userId: candidate.userId,
		issuedAt: candidate.issuedAt,
		expiresAt: candidate.expiresAt,
	};
}

/**
 * Verify a token for `userId`. Pure: no cookie or database access.
 *
 * Order matters: the signature is checked before any claim is trusted, then
 * the user binding, then expiry. A token from another account is reported the
 * same way as a forged one.
 */
export function verifyStepUpToken(
	token: string | undefined | null,
	userId: string,
	now: Date = new Date(),
): StepUpVerification {
	if (!token) return { valid: false, reason: "missing" };

	const parts = token.split(".");
	if (parts.length !== 2) return { valid: false, reason: "tampered" };
	const [encoded, signature] = parts;
	if (!encoded || !signature) return { valid: false, reason: "tampered" };
	// SHA-256 base64url is exactly 43 characters. Validate both parts so junk
	// characters cannot be silently ignored by a lenient base64 decoder.
	if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
		return { valid: false, reason: "tampered" };
	}

	const provided = Buffer.from(signature, "utf8");
	const expected = Buffer.from(sign(encoded), "utf8");
	if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
		return { valid: false, reason: "tampered" };
	}

	const payload = parsePayload(encoded);
	if (!payload) return { valid: false, reason: "tampered" };
	if (payload.userId !== userId) return { valid: false, reason: "tampered" };
	if (payload.expiresAt <= now.getTime()) return { valid: false, reason: "expired" };

	return { valid: true, stepUpAt: new Date(payload.issuedAt) };
}

async function readStepUpCookie(): Promise<string | undefined> {
	const cookieStore = await cookies();
	return cookieStore.get(STEP_UP_COOKIE)?.value;
}

/** Resolve the current user's step-up freshness. Never throws. */
export async function getStepUpState(now: Date = new Date()): Promise<StepUpState> {
	const user = await getCurrentUser();
	if (!user) return { active: false, stepUpAt: null, reason: "unauthenticated" };

	const result = verifyStepUpToken(await readStepUpCookie(), user.id, now);
	if (!result.valid) return { active: false, stepUpAt: null, reason: result.reason };
	return { active: true, stepUpAt: result.stepUpAt };
}

/**
 * Require a fresh step-up check for the current user and return when the
 * password was verified. Throws `StepUpRequiredError` (fail-closed).
 */
export async function requireStepUp(now: Date = new Date()): Promise<Date> {
	const state = await getStepUpState(now);
	if (!state.active) throw new StepUpRequiredError(state.reason);
	return state.stepUpAt;
}

/**
 * Run a mutation only when a fresh step-up exists, passing the verification
 * time so the audit row can record `stepUpAt`.
 */
export async function withStepUp<T>(
	action: (stepUpAt: Date) => Promise<T>,
	now: Date = new Date(),
): Promise<T> {
	return action(await requireStepUp(now));
}

/** Set the signed cookie after a successful password check. */
export async function setStepUpCookie(userId: string, now: Date = new Date()): Promise<Date> {
	const cookieStore = await cookies();
	const expiresAt = new Date(now.getTime() + STEP_UP_TTL_MS);
	cookieStore.set(STEP_UP_COOKIE, createStepUpToken(userId, now), {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict",
		path: "/",
		maxAge: Math.floor(STEP_UP_TTL_MS / 1000),
	});
	return expiresAt;
}

/** Drop the cookie (used on sign-out or when a check must be repeated). */
export async function clearStepUpCookie(): Promise<void> {
	const cookieStore = await cookies();
	cookieStore.delete(STEP_UP_COOKIE);
}
