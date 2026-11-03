import type { MemberRole, UserRole } from "@prisma/client";

/**
 * Who may change `Pond.notificationPrefs` (#748).
 *
 * The column is a single row shared by every alert recipient of the pond, but
 * the profile form presented it as a personal setting and the action accepted
 * any write-access member. One operator toggling something off silenced alerts
 * for the owner and everyone else.
 *
 * Policy: the pond owner, or an active OWNER/ADMIN membership. Accounts created
 * before memberships existed fall back to the legacy ADMIN flag, the same
 * fallback `resolveWriteAuthority` uses. Pure so the UI gate and the server gate
 * cannot drift apart.
 */
export function canManagePondAlerts(input: {
	/** The caller's farm is the active pond's owner farm. */
	isPondOwner: boolean;
	/** Roles of memberships with `revokedAt: null` in ACTIVE organizations. */
	activeMembershipRoles: readonly MemberRole[];
	/** True when the account has at least one membership row, active or not. */
	hasAnyMembership: boolean;
	legacyRole: UserRole;
}): boolean {
	if (input.isPondOwner) return true;

	if (input.activeMembershipRoles.length > 0) {
		return input.activeMembershipRoles.some((role) => role === "OWNER" || role === "ADMIN");
	}

	// Membership still wins when every row was revoked: a former admin must not
	// fall back to a stale global flag.
	if (input.hasAnyMembership) return false;

	return input.legacyRole === "ADMIN";
}
