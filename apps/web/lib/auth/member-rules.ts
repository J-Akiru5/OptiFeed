import type { MemberRole } from "@prisma/client";

/**
 * Pure membership rules shared by the tenant Members settings and the
 * platform organization console.
 *
 * These are deliberately synchronous and database-free: the server actions
 * resolve the caller/target state, then ask one function here whether the
 * change is allowed. Keeping the policy in one place is what stops the tenant
 * and platform paths from drifting apart (the platform path may intentionally
 * skip only the tenant invariants it documents, e.g. last-owner protection).
 */

export const MEMBER_ROLES = ["OWNER", "ADMIN", "OPERATOR", "VIEWER"] as const;

export function isMemberRole(value: unknown): value is MemberRole {
	return typeof value === "string" && (MEMBER_ROLES as readonly string[]).includes(value);
}

/** Roles an OWNER/ADMIN membership can hold in the tenant console. */
function isTenantAdminRole(role: MemberRole): boolean {
	return role === "OWNER" || role === "ADMIN";
}

export const SELF_ROLE_CHANGE_MESSAGE = "You cannot change your own role.";
export const SELF_REVOKE_MESSAGE = "You cannot revoke your own membership.";
export const ADMIN_PROMOTE_OWNER_MESSAGE = "Only an owner can promote a member to owner.";
export const ADMIN_EDIT_OWNER_MESSAGE = "Only an owner can change another owner's role.";
export const ADMIN_REMOVE_OWNER_MESSAGE = "Only an owner can remove another owner.";
export const LAST_OWNER_MESSAGE =
	"The last owner cannot be demoted or removed. Promote another owner first.";
export const OWNER_INVITE_MESSAGE = "Only an owner can invite another owner.";
export const ADMIN_EDIT_OWNER_EMAIL_MESSAGE = "Only an owner can change another owner's email.";
export const MEMBER_OTHER_ORG_EMAIL_MESSAGE =
	"This account also belongs to an organization you do not administer, so its email can only be changed from the platform console.";

/**
 * Why a tenant role change is not allowed, or null when it is.
 *
 * `activeOwnerCount` is only consulted when the target is currently the OWNER
 * and the change would take that away; callers may pass 0 for every other
 * change because the last-owner rule cannot apply.
 */
export function roleChangeError(input: {
	actorRole: MemberRole;
	targetRole: MemberRole;
	nextRole: MemberRole;
	isSelf: boolean;
	activeOwnerCount: number;
}): string | null {
	if (input.isSelf) return SELF_ROLE_CHANGE_MESSAGE;
	if (input.nextRole === input.targetRole) return null;

	if (input.actorRole === "ADMIN") {
		if (input.nextRole === "OWNER") return ADMIN_PROMOTE_OWNER_MESSAGE;
		if (input.targetRole === "OWNER") return ADMIN_EDIT_OWNER_MESSAGE;
	}

	if (input.targetRole === "OWNER" && input.nextRole !== "OWNER" && input.activeOwnerCount <= 1) {
		return LAST_OWNER_MESSAGE;
	}

	return null;
}

/** Why a tenant membership revocation is not allowed, or null when it is. */
export function revokeMemberError(input: {
	actorRole: MemberRole;
	targetRole: MemberRole;
	isSelf: boolean;
	activeOwnerCount: number;
}): string | null {
	if (input.isSelf) return SELF_REVOKE_MESSAGE;
	if (input.actorRole === "ADMIN" && input.targetRole === "OWNER") {
		return ADMIN_REMOVE_OWNER_MESSAGE;
	}
	if (input.targetRole === "OWNER" && input.activeOwnerCount <= 1) {
		return LAST_OWNER_MESSAGE;
	}
	return null;
}

/** Why the tenant caller may not invite at `role`, or null when they may. */
export function inviteRoleError(actorRole: MemberRole, role: MemberRole): string | null {
	if (role === "OWNER" && actorRole !== "OWNER") return OWNER_INVITE_MESSAGE;
	return null;
}

/**
 * Why a tenant caller may not change this member's contact email, or null when
 * they may (#449).
 *
 * The contact email decides where a password-reset link is sent, so changing it
 * is a way to take over the account. An ADMIN therefore may not change an
 * OWNER's, the same boundary as roles and revocation. Changing your own is
 * allowed: the caller already holds the account.
 */
export function contactEmailEditError(input: {
	actorRole: MemberRole;
	targetRole: MemberRole;
}): string | null {
	if (input.actorRole === "ADMIN" && input.targetRole === "OWNER") {
		return ADMIN_EDIT_OWNER_EMAIL_MESSAGE;
	}
	return null;
}

/**
 * Why a tenant caller may not change this account's contact email given every
 * active membership the account holds, or null when they may (#449).
 *
 * An account that also sits in an organization the caller does not administer
 * is refused: the address would redirect password resets for a login another
 * tenant relies on, so only the platform console may change it. Where the
 * caller does administer the organization, the hierarchy rule applies in each.
 */
export function contactEmailTargetError(input: {
	actorRoleByOrg: ReadonlyMap<string, MemberRole>;
	targetMemberships: readonly { orgId: string; role: MemberRole }[];
}): string | null {
	for (const target of input.targetMemberships) {
		const actorRole = input.actorRoleByOrg.get(target.orgId);
		if (!actorRole) return MEMBER_OTHER_ORG_EMAIL_MESSAGE;
		const error = contactEmailEditError({ actorRole, targetRole: target.role });
		if (error) return error;
	}
	return null;
}
