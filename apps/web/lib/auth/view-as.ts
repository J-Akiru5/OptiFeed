import { createHmac, timingSafeEqual } from "node:crypto";
import { isPlatformAdminActive } from "@/lib/auth/platform-admin";
import prisma from "@/lib/prisma";
import { cookies } from "next/headers";
import { cache } from "react";
import { getCurrentUser } from "./session";

/**
 * Read-only view-as (plan M5.1, decision D1).
 *
 * A platform admin starts an `ImpersonationSession` for an org, then opens the
 * tenant dashboard as that tenant. The session is READ_ONLY: reads resolve to
 * the target farm, while every tenant write guard calls `assertNotViewingAs()`
 * and fails closed. The session ends on exit or after 30 minutes, and both the
 * start and the stop write a PlatformAuditLog row under the real actor.
 *
 * The cookie is a signed pointer to the database row (session id, actor, org,
 * farm, expiry); it never carries tenant credentials and is useless once the
 * row is ended, expired, or the admin's grant is revoked. The signing key is
 * derived from the existing server-only SUPABASE_SERVICE_ROLE_KEY with a
 * domain-separation label, so no new environment variable is required (same
 * approach as lib/auth/step-up.ts).
 *
 * `assertNotViewingAs` is the one shared helper the write guards use:
 * `requireWriteAccess` and `canWrite` in lib/auth/session.ts, and
 * `requirePermission` in lib/auth/permissions.ts.
 */

export const VIEW_AS_COOKIE = "viewas";
export const VIEW_AS_TTL_MS = 30 * 60 * 1000;
export const VIEW_AS_MODE = "READ_ONLY";
export const VIEW_AS_BLOCKED_CODE = "view_as_read_only";

export type ViewAsFailureReason =
	| "unauthenticated"
	| "missing"
	| "expired"
	| "tampered"
	| "ended"
	| "revoked"
	| "mismatch"
	| "unavailable";

export type ViewAsPayload = {
	sid: string;
	actorUserId: string;
	orgId: string;
	farmId: string;
	issuedAt: number;
	expiresAt: number;
};

export type ViewAsState =
	| {
			active: true;
			sessionId: string;
			actorUserId: string;
			orgId: string;
			farmId: string;
			reason: string;
			expiresAt: Date;
	  }
	| { active: false; reason: ViewAsFailureReason };

export class ViewAsReadOnlyError extends Error {
	readonly code = VIEW_AS_BLOCKED_CODE;

	constructor() {
		super("This is a read-only view-as session. Exit view-as to make changes.");
		this.name = "ViewAsReadOnlyError";
	}
}

export function isViewAsReadOnlyError(
	error: unknown,
): error is { code: typeof VIEW_AS_BLOCKED_CODE; message: string } {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === VIEW_AS_BLOCKED_CODE
	);
}

function requireSigningSecret(): string {
	const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!secret) {
		throw new Error("View-as signing is unavailable: SUPABASE_SERVICE_ROLE_KEY is not set.");
	}
	return secret;
}

function signingKey(): Buffer {
	return createHmac("sha256", requireSigningSecret()).update("optifeed:viewas:v1").digest();
}

function sign(payload: string): string {
	return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export type ViewAsVerification =
	| { valid: true; payload: ViewAsPayload }
	| { valid: false; reason: ViewAsFailureReason };

function isNonEmptyString(value: unknown, max = 200): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max;
}

function parsePayload(encoded: string): ViewAsPayload | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const candidate = parsed as Partial<ViewAsPayload>;
	if (!isNonEmptyString(candidate.sid)) return null;
	if (!isNonEmptyString(candidate.actorUserId)) return null;
	if (!isNonEmptyString(candidate.orgId)) return null;
	if (!isNonEmptyString(candidate.farmId)) return null;
	if (typeof candidate.issuedAt !== "number" || !Number.isFinite(candidate.issuedAt)) return null;
	if (typeof candidate.expiresAt !== "number" || !Number.isFinite(candidate.expiresAt)) return null;
	return {
		sid: candidate.sid,
		actorUserId: candidate.actorUserId,
		orgId: candidate.orgId,
		farmId: candidate.farmId,
		issuedAt: candidate.issuedAt,
		expiresAt: candidate.expiresAt,
	};
}

/** Create a signed view-as cookie value. Exported for the action and tests. */
export function createViewAsToken(
	input: { sid: string; actorUserId: string; orgId: string; farmId: string },
	now: Date = new Date(),
): string {
	const issuedAt = now.getTime();
	const payload: ViewAsPayload = {
		...input,
		issuedAt,
		expiresAt: issuedAt + VIEW_AS_TTL_MS,
	};
	const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
	return `${encoded}.${sign(encoded)}`;
}

/**
 * Verify a token for `actorUserId`. Pure: no cookie or database access.
 *
 * Signature first, then the actor binding, then expiry. A token from another
 * account is reported the same way as a forged one. `allowExpired` is used only
 * by the exit path, so an expired session's row can still be closed and
 * audited; it never makes the session usable for reads or writes.
 */
export function verifyViewAsToken(
	token: string | undefined | null,
	actorUserId: string,
	now: Date = new Date(),
	options: { allowExpired?: boolean } = {},
): ViewAsVerification {
	if (!token) return { valid: false, reason: "missing" };

	const parts = token.split(".");
	if (parts.length !== 2) return { valid: false, reason: "tampered" };
	const [encoded, signature] = parts;
	if (!encoded || !signature) return { valid: false, reason: "tampered" };
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
	if (payload.actorUserId !== actorUserId) return { valid: false, reason: "tampered" };
	if (!options.allowExpired && payload.expiresAt <= now.getTime()) {
		return { valid: false, reason: "expired" };
	}

	return { valid: true, payload };
}

async function readViewAsCookie(): Promise<string | undefined> {
	try {
		const cookieStore = await cookies();
		return cookieStore.get(VIEW_AS_COOKIE)?.value;
	} catch {
		return undefined;
	}
}

/**
 * Resolve the caller's view-as state, checking the signed cookie against the
 * database row and the admin's live grant. Never throws: anything unexpected
 * resolves to inactive, so a broken lookup can never grant tenant reads or
 * accidentally block writes.
 */
export async function resolveViewAsState(now: Date = new Date()): Promise<ViewAsState> {
	const user = await getCurrentUser();
	if (!user) return { active: false, reason: "unauthenticated" };

	const verification = verifyViewAsToken(await readViewAsCookie(), user.id, now);
	if (!verification.valid) return { active: false, reason: verification.reason };
	const payload = verification.payload;

	try {
		const [session, grant] = await Promise.all([
			prisma.impersonationSession.findUnique({
				where: { id: payload.sid },
				select: {
					actorUserId: true,
					orgId: true,
					mode: true,
					reason: true,
					expiresAt: true,
					endedAt: true,
				},
			}),
			prisma.platformAdmin.findUnique({
				where: { userId: user.id },
				select: { revokedAt: true, expiresAt: true },
			}),
		]);

		if (!session) return { active: false, reason: "mismatch" };
		if (session.actorUserId !== user.id || session.orgId !== payload.orgId) {
			return { active: false, reason: "mismatch" };
		}
		if (session.mode !== VIEW_AS_MODE) return { active: false, reason: "mismatch" };
		if (session.endedAt) return { active: false, reason: "ended" };
		if (session.expiresAt.getTime() <= now.getTime()) return { active: false, reason: "expired" };
		if (!grant || !isPlatformAdminActive(grant, now)) {
			return { active: false, reason: "revoked" };
		}

		return {
			active: true,
			sessionId: payload.sid,
			actorUserId: user.id,
			orgId: session.orgId,
			farmId: payload.farmId,
			reason: session.reason,
			expiresAt: session.expiresAt,
		};
	} catch {
		return { active: false, reason: "unavailable" };
	}
}

/** Per-request cached state for the render tree and server actions. */
export const getViewAsState = cache(
	async (): Promise<ViewAsState> => resolveViewAsState(new Date()),
);

export async function isViewingAs(): Promise<boolean> {
	return (await getViewAsState()).active;
}

/**
 * The shared write guard: throws while a view-as session is active for the
 * caller. Used by requireWriteAccess/canWrite and requirePermission.
 */
export async function assertNotViewingAs(): Promise<void> {
	if (await isViewingAs()) throw new ViewAsReadOnlyError();
}

export async function setViewAsCookie(token: string, expiresAt: Date): Promise<void> {
	const cookieStore = await cookies();
	cookieStore.set(VIEW_AS_COOKIE, token, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		expires: expiresAt,
	});
}

export async function clearViewAsCookie(): Promise<void> {
	try {
		const cookieStore = await cookies();
		cookieStore.delete(VIEW_AS_COOKIE);
	} catch {
		// Outside a request scope (tests, scripts) there is nothing to clear.
	}
}
