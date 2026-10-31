import { randomBytes } from "node:crypto";
import { buildPondEmail } from "@/lib/auth/session";
import { normalizeContactEmail } from "@/lib/contact-email";
import { isDeliverableEmail } from "@/lib/notify/invite-email";
import prisma from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MemberRole, Prisma } from "@prisma/client";

/**
 * Shared member provisioning for the tenant Members settings and the platform
 * organization console.
 *
 * This module is plain server code (no "use server"): it is imported by the two
 * action files, not callable directly.
 *
 * There is no email-invite table in the schema, and every login in this app is
 * a pond address (`<login-id>@pond.optifeed.local`), so an "invite by email"
 * is handled as:
 *
 * - an existing account is attached/reactivated in the organization, or
 * - a new account is provisioned through the same Supabase-then-transaction
 *   shape as createPondWithFarmer/createPlatformUser, with a generated
 *   temporary password returned once to the caller.
 *
 * This module does not send mail. The caller sends the invitation through
 * `lib/notify/invite-email.ts` to the real address the inviter typed, and the
 * member is forced to change the one-time password on first login. The pond
 * address itself is never a deliverable mailbox, so a new account keeps the
 * typed address as its `contactEmail` (#449), which is where a password-reset
 * link goes later.
 */

export type InviteLinkTransaction = Pick<Prisma.TransactionClient, "platformAuditLog">;

export type InviteMemberInput = {
	orgId: string;
	/** The address the admin typed. The part before @ becomes the login id. */
	email: string;
	displayName: string;
	role: MemberRole;
	invitedBy: string;
	/**
	 * Tenant actions refuse a target that is already a platform admin (that
	 * grant is managed from /superadmin). The platform console may attach one.
	 */
	refusePlatformAdminTarget?: boolean;
	/**
	 * Runs inside the provisioning transaction, after the user and membership
	 * exist. The platform actions use it to write their single audit row in the
	 * same transaction; the tenant action has no audit table for this.
	 *
	 * The temporary password is deliberately not passed here, so a hook cannot
	 * accidentally persist it.
	 */
	onLinked?: (
		tx: InviteLinkTransaction,
		linked: {
			membershipId: string;
			userId: string;
			loginEmail: string;
			createdUser: boolean;
		},
	) => Promise<void>;
};

export type InviteMemberSuccess = {
	success: true;
	membershipId: string;
	userId: string;
	loginEmail: string;
	/**
	 * Present only when a new login was created. Returned once, never logged
	 * and never written to an audit row.
	 */
	temporaryPassword: string | null;
	createdUser: boolean;
};

export type InviteMemberResult = InviteMemberSuccess | { success: false; error: string };

export type LoginIdentity = { loginId: string; loginEmail: string };

const MAX_LOGIN_ID_LENGTH = 64;

/**
 * Turn an admin-entered address into the account's login identity.
 *
 * The local part is normalized to the login-id alphabet (lowercase letters,
 * digits and hyphens). The domain is intentionally not preserved: the app's
 * auth model only signs in accounts on the pond domain, because
 * `getCurrentUser` requires the session email to match the user's farmId.
 */
export function deriveLoginIdentity(rawEmail: string): LoginIdentity | null {
	const value = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
	if (!value) return null;
	// The typed address is both the invite destination and the login-id source,
	// so reject a typo before provisioning an account or sending mail.
	if (!isDeliverableEmail(value)) return null;

	const parts = value.split("@");
	if (parts.length !== 2) return null;
	const [local, domain] = parts;
	if (!local || !domain) return null;

	const loginId = local.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	if (!loginId || loginId.length > MAX_LOGIN_ID_LENGTH) return null;

	return { loginId, loginEmail: buildPondEmail(loginId) };
}

/** One-time temporary password. Only the caller sees it, once. */
function generateTemporaryPassword(): string {
	return randomBytes(12).toString("base64url");
}

/** MemberRole -> legacy global UserRole, which still gates dashboard writes. */
function globalRoleFor(role: MemberRole): "ADMIN" | "OPERATOR" | "VIEWER" {
	if (role === "OWNER" || role === "ADMIN") return "ADMIN";
	if (role === "VIEWER") return "VIEWER";
	return "OPERATOR";
}

export async function inviteOrAttachMember(input: InviteMemberInput): Promise<InviteMemberResult> {
	const identity = deriveLoginIdentity(input.email);
	if (!identity) {
		return {
			success: false,
			error: "Enter a valid email address. Use letters, numbers or hyphens before the @.",
		};
	}

	const displayName = input.displayName?.trim() ?? "";
	if (!displayName) return { success: false, error: "Display name is required." };
	if (displayName.length > 80) return { success: false, error: "Display name is too long." };

	const existing = await prisma.user.findFirst({
		where: {
			OR: [{ email: identity.loginEmail }, { farmId: identity.loginId }],
		},
		select: { id: true, email: true },
	});

	if (existing) {
		if (input.refusePlatformAdminTarget !== false) {
			const grant = await prisma.platformAdmin.findFirst({
				where: { userId: existing.id, revokedAt: null },
				select: { id: true },
			});
			if (grant) {
				return {
					success: false,
					error: "Platform administrators must be managed from the platform console.",
				};
			}
		}

		const current = await prisma.membership.findUnique({
			where: { orgId_userId: { orgId: input.orgId, userId: existing.id } },
			select: { id: true, revokedAt: true },
		});
		if (current && current.revokedAt === null) {
			return { success: false, error: "That account is already a member of this organization." };
		}

		try {
			const membershipId = await prisma.$transaction(async (tx) => {
				// A re-invite starts from the role defaults, not stale overrides.
				if (current) {
					await tx.membershipPermission.deleteMany({
						where: { membershipId: current.id },
					});
				}

				const membership = current
					? await tx.membership.update({
							where: { id: current.id },
							data: {
								role: input.role,
								invitedBy: input.invitedBy,
								revokedAt: null,
							},
							select: { id: true },
						})
					: await tx.membership.create({
							data: {
								orgId: input.orgId,
								userId: existing.id,
								role: input.role,
								invitedBy: input.invitedBy,
							},
							select: { id: true },
						});

				if (input.onLinked) {
					await input.onLinked(tx, {
						membershipId: membership.id,
						userId: existing.id,
						loginEmail: existing.email,
						createdUser: false,
					});
				}

				return membership.id;
			});

			return {
				success: true,
				membershipId,
				userId: existing.id,
				loginEmail: existing.email,
				temporaryPassword: null,
				createdUser: false,
			};
		} catch (e) {
			console.error(
				"[members] attach existing account failed:",
				e instanceof Error ? e.message : "unknown error",
			);
			return { success: false, error: "Failed to add the member." };
		}
	}

	// Keep the typed address as the contact email unless another account already
	// holds it: the column is unique, and a clash must not fail the invite.
	const typed = normalizeContactEmail(input.email);
	const contactEmail =
		typed.ok && typed.value
			? (await prisma.user.findFirst({
					where: { contactEmail: typed.value },
					select: { id: true },
				}))
				? null
				: typed.value
			: null;

	const temporaryPassword = generateTemporaryPassword();
	const supabase = createAdminClient();
	const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
		email: identity.loginEmail,
		password: temporaryPassword,
		email_confirm: true,
	});
	if (authError || !authUser?.user) {
		return {
			success: false,
			error: `Failed to create the account: ${authError?.message ?? "unknown error"}`,
		};
	}

	const authUserId = authUser.user.id;

	try {
		const { membershipId, userId } = await prisma.$transaction(async (tx) => {
			const user = await tx.user.create({
				data: {
					supabaseId: authUserId,
					farmId: identity.loginId,
					email: identity.loginEmail,
					contactEmail,
					displayName,
					role: globalRoleFor(input.role),
					mustChangePassword: true,
				},
				select: { id: true },
			});

			const membership = await tx.membership.create({
				data: {
					orgId: input.orgId,
					userId: user.id,
					role: input.role,
					invitedBy: input.invitedBy,
				},
				select: { id: true },
			});

			if (input.onLinked) {
				await input.onLinked(tx, {
					membershipId: membership.id,
					userId: user.id,
					loginEmail: identity.loginEmail,
					createdUser: true,
				});
			}

			return { membershipId: membership.id, userId: user.id };
		});

		return {
			success: true,
			membershipId,
			userId,
			loginEmail: identity.loginEmail,
			temporaryPassword,
			createdUser: true,
		};
	} catch (e) {
		// Do not strand a login with no app row.
		await supabase.auth.admin.deleteUser(authUserId).catch(() => undefined);
		console.error(
			"[members] create account failed:",
			e instanceof Error ? e.message : "unknown error",
		);
		return { success: false, error: "Failed to create the member." };
	}
}
