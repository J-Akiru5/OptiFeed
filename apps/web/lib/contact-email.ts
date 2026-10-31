import { isDeliverableEmail } from "@/lib/notify/invite-email";

/**
 * Contact email (#449).
 *
 * `User.email` is the synthetic login address `<login-id>@pond.optifeed.local`
 * that sign-in derives from the farm ID (see `buildPondEmail` in
 * `lib/auth/session.ts`). It can never receive mail and must not change, or the
 * farm ID would stop signing in. `User.contactEmail` is the separate,
 * deliverable address an administrator records so a password-reset link has
 * somewhere to go.
 */

/** Mirrors `POND_EMAIL_DOMAIN` in `lib/auth/session.ts` without importing the session module. */
const POND_EMAIL_DOMAIN = "pond.optifeed.local";

export type ContactEmailResult = { ok: true; value: string | null } | { ok: false; error: string };

export const CONTACT_EMAIL_INVALID = "Enter a valid email address.";
export const CONTACT_EMAIL_POND =
	"That is an internal login address and cannot receive mail. Enter a real mailbox.";
export const CONTACT_EMAIL_TAKEN = "That email is already registered to another account.";

/**
 * Normalise what an administrator typed. Blank clears the address (`null`);
 * anything else must be a deliverable mailbox on a real domain. The stored form
 * is lower-case so the unique index and the reset lookup agree.
 */
export function normalizeContactEmail(raw: unknown): ContactEmailResult {
	if (raw === null || raw === undefined) return { ok: true, value: null };
	if (typeof raw !== "string") return { ok: false, error: CONTACT_EMAIL_INVALID };

	const value = raw.trim().toLowerCase();
	if (!value) return { ok: true, value: null };
	if (!isDeliverableEmail(value)) return { ok: false, error: CONTACT_EMAIL_INVALID };
	if (value.endsWith(`@${POND_EMAIL_DOMAIN}`)) return { ok: false, error: CONTACT_EMAIL_POND };
	return { ok: true, value };
}

/**
 * Split what someone typed on the forgot-password page into the key to look the
 * account up by: a contact email, or a login ID (a bare farm ID, or the pond
 * address the profile page used to show, which is the farm ID plus the pond
 * domain).
 */
export function parseResetIdentifier(
	raw: unknown,
): { kind: "email"; value: string } | { kind: "farmId"; value: string } | null {
	if (typeof raw !== "string") return null;
	const value = raw.trim().toLowerCase();
	if (!value || value.length > 254) return null;

	if (!value.includes("@")) return { kind: "farmId", value };

	const suffix = `@${POND_EMAIL_DOMAIN}`;
	if (value.endsWith(suffix)) {
		const farmId = value.slice(0, -suffix.length);
		return farmId && !farmId.includes("@") ? { kind: "farmId", value: farmId } : null;
	}
	return { kind: "email", value };
}

/**
 * True when a failed `User` update hit the unique `contactEmail` index.
 *
 * Callers that change only `contactEmail` can read any unique violation (Prisma
 * code P2002) as a conflict: no other unique column is written, so the target
 * metadata, which differs between the Prisma engine and driver adapters, does
 * not need parsing.
 */
export function isContactEmailConflict(error: unknown): boolean {
	return (
		typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
	);
}
