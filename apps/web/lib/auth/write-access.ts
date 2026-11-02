import type { MemberRole, UserRole } from "@prisma/client";

/**
 * Tenant write authority (#583).
 *
 * Tenant authority is `Membership.role` in an ACTIVE `Organization`. The legacy
 * global `User.role` column is *not* authority: demoting someone to VIEWER only
 * updates the membership, so a write gate that reads `User.role` keeps accepting
 * their calls while the UI hides the buttons. That is the bug this module exists
 * to stop.
 *
 * The functions here are pure and database-free on purpose: `session.ts` resolves
 * the rows (the chain is in `resolveWriteAuthorityForCurrentUser`), then asks one
 * function whether the caller may write. Keeping the policy here means the async
 * gate and `canWrite()` cannot disagree about the same account.
 */

/**
 * Membership roles that may perform tenant writes. VIEWER is the only read-only
 * role. Kept private: callers ask `membershipAllowsWrite()` so the rule cannot be
 * duplicated from a partial list.
 */
const WRITE_ROLES = ["OWNER", "ADMIN", "OPERATOR"] as const;

/** True when a membership role may write. VIEWER is the only read-only role. */
export function membershipAllowsWrite(role: MemberRole): boolean {
	return (WRITE_ROLES as readonly MemberRole[]).includes(role);
}

/**
 * True when the legacy global role would allow a write.
 *
 * Only consulted for accounts that have no membership row at all — the
 * pre-membership backfill accounts. See `resolveWriteAuthority`.
 */
export function legacyRoleAllowsWrite(role: UserRole): boolean {
	return role === "ADMIN" || role === "OPERATOR";
}

/**
 * Where the decision came from. Callers log nothing, but tests and the denial
 * path distinguish "denied because the membership says VIEWER" from "denied
 * because the memberships were revoked" instead of treating both as a missing
 * row.
 */
export type WriteAuthoritySource = "membership" | "legacy" | "none";

export type WriteAuthority = {
	allowed: boolean;
	source: WriteAuthoritySource;
};

/**
 * Decide write authority from the account's rows.
 *
 * Membership wins over the legacy flag, in this order:
 *
 * 1. An active membership in an ACTIVE organization is the answer. If any of
 *    them may write, the caller may write; a VIEWER-only membership denies even
 *    when `User.role` is still `OPERATOR` (the demotion bug).
 * 2. No active membership but at least one row exists (revoked, or only in a
 *    suspended org) denies. Membership still wins: a revoked member must not
 *    fall back to a stale global flag and keep writing.
 * 3. No membership row at all is the only fallback to `User.role`. Those are
 *    accounts created before memberships existed; the 20261017010000 backfill
 *    only covered legacy ADMIN accounts, so legacy OPERATOR farmers still rely
 *    on this branch.
 */
export function resolveWriteAuthority(input: {
	legacyRole: UserRole;
	/** Roles of memberships with `revokedAt: null` in ACTIVE organizations. */
	activeMembershipRoles: readonly MemberRole[];
	/** True when the account has at least one membership row, active or not. */
	hasAnyMembership: boolean;
}): WriteAuthority {
	if (input.activeMembershipRoles.length > 0) {
		return {
			allowed: input.activeMembershipRoles.some(membershipAllowsWrite),
			source: "membership",
		};
	}

	if (input.hasAnyMembership) {
		return { allowed: false, source: "none" };
	}

	return { allowed: legacyRoleAllowsWrite(input.legacyRole), source: "legacy" };
}
