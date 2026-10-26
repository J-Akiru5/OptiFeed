"use server";

import { passwordErrorMessage, validatePassword } from "@/lib/auth/password";
import { isPlatformAdminActive } from "@/lib/auth/platform-admin";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { buildPondEmail, getCurrentUser } from "@/lib/auth/session";
import { invalidateFarm } from "@/lib/auth/session-cache";
import { isStepUpRequiredError, withStepUp } from "@/lib/auth/step-up";
import prisma from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MemberRole, Prisma, UserRole } from "@prisma/client";

/**
 * Platform-console actions. Every export is gated by requirePlatformAdmin()
 * — the PlatformAdmin row is the god-mode source of truth, not UserRole.
 *
 * Superadmin powers per the 3-tier model: manage all accounts, create and
 * inspect tenants/orgs, and *read* ponds. It has no farmer function: there is
 * no schedule, device, or pond-mutation action here by design.
 *
 * Organization, Membership, PlatformAdmin and PlatformAuditLog are deliberately
 * relation-free (plan §3.2), so every association below is an explicit join
 * rather than a Prisma `include`.
 */

const MIN_REASON_LENGTH = 10;

const LAST_PLATFORM_ADMIN_MESSAGE =
	"At least one active platform administrator must remain. Grant another admin first.";

/**
 * `PlatformAdmin` rows that currently grant god-mode: unrevoked and, when
 * time-boxed, not yet expired — the same rule as isPlatformAdminActive.
 */
function activePlatformAdminWhere(): Prisma.PlatformAdminWhereInput {
	return {
		revokedAt: null,
		OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
	};
}

function requireReason(reason: string | undefined): string {
	const trimmed = reason?.trim() ?? "";
	if (trimmed.length < MIN_REASON_LENGTH) {
		throw new Error(`A reason of at least ${MIN_REASON_LENGTH} characters is required.`);
	}
	return trimmed;
}

/** Append an audit row (T5). Every mutation in this file calls it. */
async function audit(
	data: {
		action: string;
		targetId: string;
		reason: string;
		actorUserId: string;
		temporaryGrant?: boolean;
		/** When the dangerous action's password check happened (M3.2). */
		stepUpAt?: Date;
		before?: Prisma.InputJsonValue;
		after?: Prisma.InputJsonValue;
	},
	tx: Prisma.TransactionClient,
): Promise<void> {
	await tx.platformAuditLog.create({
		data: {
			actorUserId: data.actorUserId,
			action: data.action,
			targetType: "platform_console",
			targetId: data.targetId,
			reason: data.reason,
			stepUpAt: data.stepUpAt ?? null,
			temporaryGrant: data.temporaryGrant ?? false,
			...(data.before !== undefined ? { before: data.before } : {}),
			...(data.after !== undefined ? { after: data.after } : {}),
		},
	});
}

/** The acting superadmin's user id — recorded as the audit actor. */
async function actorId(): Promise<string> {
	const user = await getCurrentUser();
	if (!user) throw new Error("Not authenticated.");
	return user.id;
}

// ─── Overview ─────────────────────────────────────────────────────────────────

export type SuperadminStats = {
	userCount: number;
	orgCount: number;
	pondCount: number;
	platformAdminCount: number;
	activePlatformAdminCount: number;
};

export async function getSuperadminStats(): Promise<SuperadminStats> {
	await requirePlatformAdmin();

	const [userCount, orgCount, pondCount, platformAdmins] = await Promise.all([
		prisma.user.count(),
		prisma.organization.count(),
		prisma.pond.count(),
		prisma.platformAdmin.findMany({ select: { revokedAt: true, expiresAt: true } }),
	]);

	return {
		userCount,
		orgCount,
		pondCount,
		platformAdminCount: platformAdmins.length,
		activePlatformAdminCount: platformAdmins.filter((r) => isPlatformAdminActive(r)).length,
	};
}

// ─── Users ────────────────────────────────────────────────────────────────────

export type PlatformUserRow = {
	id: string;
	farmId: string;
	email: string;
	displayName: string | null;
	role: UserRole;
	createdAt: Date;
	isPlatformAdmin: boolean;
	/** True after a safe disable (auth ban + revoked memberships). */
	disabled: boolean;
	orgs: { id: string; name: string; role: MemberRole; memberCount: number }[];
	pondCount: number;
};

/** Per-org active member counts, keyed by orgId. */
async function activeMemberCounts(orgIds: string[]): Promise<Map<string, number>> {
	if (orgIds.length === 0) return new Map();
	const groups = await prisma.membership.groupBy({
		by: ["orgId"],
		where: { orgId: { in: orgIds }, revokedAt: null },
		_count: { _all: true },
	});
	return new Map(groups.map((g) => [g.orgId, g._count._all]));
}

/**
 * Every user across every tenant, with their org memberships resolved.
 * Superadmin sees all of them — including other admins and platform admins.
 */
export async function listAllUsers(): Promise<PlatformUserRow[]> {
	await requirePlatformAdmin();

	const [users, memberships, orgs, platformAdmins] = await Promise.all([
		prisma.user.findMany({
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				farmId: true,
				email: true,
				displayName: true,
				role: true,
				createdAt: true,
				_count: { select: { ponds: true } },
			},
		}),
		prisma.membership.findMany({ where: { revokedAt: null } }),
		prisma.organization.findMany({ select: { id: true, name: true } }),
		// Only an unrevoked, unexpired grant is god-mode; a safe disable revokes
		// the grant, so the access badge must follow that.
		prisma.platformAdmin.findMany({
			where: activePlatformAdminWhere(),
			select: { userId: true },
		}),
	]);

	// Safe disable is reversible, so the list needs to know the latest state.
	// The append-only audit log is the record: no extra column or migration.
	const safetyRows =
		users.length > 0
			? await prisma.platformAuditLog.findMany({
					where: {
						action: { in: ["platform.user.disable", "platform.user.enable"] },
						targetId: { in: users.map((u) => u.id) },
					},
					orderBy: { createdAt: "desc" },
					select: { action: true, targetId: true },
				})
			: [];
	const latestSafetyAction = new Map<string, string>();
	for (const row of safetyRows) {
		if (row.targetId && !latestSafetyAction.has(row.targetId)) {
			latestSafetyAction.set(row.targetId, row.action);
		}
	}

	const orgById = new Map(orgs.map((o) => [o.id, o]));
	const counts = await activeMemberCounts(orgs.map((o) => o.id));
	const memberOrgIds = new Map<string, string[]>();
	for (const m of memberships) {
		const list = memberOrgIds.get(m.userId) ?? [];
		list.push(m.orgId);
		memberOrgIds.set(m.userId, list);
	}
	const platformAdminIds = new Set(platformAdmins.map((r) => r.userId));

	return users.map((u) => ({
		id: u.id,
		farmId: u.farmId,
		email: u.email,
		displayName: u.displayName,
		role: u.role,
		createdAt: u.createdAt,
		isPlatformAdmin: platformAdminIds.has(u.id),
		disabled: latestSafetyAction.get(u.id) === "platform.user.disable",
		pondCount: u._count.ponds,
		orgs: (memberOrgIds.get(u.id) ?? [])
			.map((orgId) => {
				const org = orgById.get(orgId);
				if (!org) return null;
				const membership = memberships.find((m) => m.userId === u.id && m.orgId === orgId);
				return {
					id: org.id,
					name: org.name,
					role: membership?.role ?? "OPERATOR",
					memberCount: counts.get(orgId) ?? 0,
				};
			})
			.filter((o): o is NonNullable<typeof o> => o !== null),
	}));
}

export type PlatformUserResult = { success: true; userId: string } | { error: string };

export type CreatePlatformUserInput = {
	reason: string;
	/** Login slug and pond-email local part. */
	farmId: string;
	displayName: string;
	/** Temporary password. The user must change it on first login. */
	password: string;
	kind: "ADMIN" | "ORG_FARMER" | "INDEPENDENT_FARMER";
	/** Required for ADMIN and ORG_FARMER; ignored for INDEPENDENT_FARMER. */
	orgId?: string;
	/** Initial pond. Required for farmer kinds — a farmer with no pond is stuck. */
	pond?: { name: string; feedingRatePct: number; feedsPerDay: number; population?: number };
};

/**
 * Create any of the three account kinds.
 *
 * ADMIN              -> role=ADMIN + OWNER membership (no farmer function)
 * ORG_FARMER         -> role=OPERATOR + OPERATOR membership + farm + pond
 * INDEPENDENT_FARMER -> role=OPERATOR + farm + pond + solo INDIVIDUAL org they own
 *
 * Login email is always the pond address: session.ts rejects any account whose
 * email local part does not match its farmId, so a custom email would strand
 * the account with no way to log in.
 */
export async function createPlatformUser(
	input: CreatePlatformUserInput,
): Promise<PlatformUserResult> {
	await requirePlatformAdmin();

	const reason = requireReason(input.reason);
	const farmId = input.farmId?.trim().toLowerCase() ?? "";
	const password = input.password ?? "";

	if (!/^[a-z0-9-]+$/.test(farmId)) {
		return { error: "Login ID must be lowercase alphanumeric with hyphens." };
	}
	if (!input.displayName?.trim()) return { error: "Display name is required." };
	const passwordCheck = validatePassword(password, "temporary");
	if (!passwordCheck.ok) return { error: passwordErrorMessage(passwordCheck.code) };
	if (input.kind !== "INDEPENDENT_FARMER" && !input.orgId) {
		return { error: "An organization is required for this account kind." };
	}
	if (input.kind !== "ADMIN" && !input.pond?.name?.trim()) {
		return { error: "An initial pond is required for a farmer account." };
	}

	const email = buildPondEmail(farmId);

	const existing = await prisma.user.findFirst({
		where: { OR: [{ farmId }, { email }] },
		select: { id: true },
	});
	if (existing) return { error: `A user with login ID "${farmId}" already exists.` };

	if (input.orgId) {
		const org = await prisma.organization.findUnique({
			where: { id: input.orgId },
			select: { id: true },
		});
		if (!org) return { error: "Organization not found." };
	}

	// Service-role client: auth.admin.createUser is rejected with the anon key.
	const supabase = createAdminClient();
	const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
	});
	if (authError) {
		return { error: `Failed to create auth account: ${authError.message}` };
	}

	const actor = await actorId();
	const role: UserRole = input.kind === "ADMIN" ? "ADMIN" : "OPERATOR";

	try {
		const userId = await prisma.$transaction(async (tx) => {
			const user = await tx.user.create({
				data: {
					supabaseId: authUser.user.id,
					farmId,
					email,
					displayName: input.displayName.trim(),
					role,
					mustChangePassword: true,
				},
			});

			// INDEPENDENT_FARMER gets a solo INDIVIDUAL org it owns; the other
			// kinds attach to an org the caller selected.
			let orgId = input.orgId ?? null;
			let membershipRole: MemberRole = input.kind === "ADMIN" ? "OWNER" : "OPERATOR";

			if (input.kind === "INDEPENDENT_FARMER") {
				const org = await tx.organization.create({
					data: { name: `${input.displayName.trim()} (independent)`, type: "INDIVIDUAL" },
				});
				orgId = org.id;
				membershipRole = "OWNER";
			}

			if (orgId) {
				await tx.membership.create({
					data: { orgId, userId: user.id, role: membershipRole, invitedBy: actor },
				});
			}

			if (input.kind !== "ADMIN") {
				const pond = input.pond;
				if (!pond?.name?.trim()) throw new Error("Initial pond is required.");

				const farm = await tx.farm.create({
					data: { ownerId: user.farmId, name: `${input.displayName.trim()} Farm` },
				});
				await tx.pond.create({
					data: {
						ownerId: user.farmId,
						farmId: farm.id,
						name: pond.name.trim(),
						feedingRatePct: pond.feedingRatePct,
						feedsPerDay: pond.feedsPerDay,
						population: pond.population ?? null,
						scheduleStart: new Date("1970-01-01T06:00:00.000Z"),
						scheduleEnd: new Date("1970-01-01T18:00:00.000Z"),
					},
				});
			}

			await audit(
				{
					action: "platform.user.create",
					targetId: user.id,
					reason,
					actorUserId: actor,
					after: { farmId, kind: input.kind, role, orgId },
				},
				tx,
			);

			return user.id;
		});

		return { success: true, userId };
	} catch (e) {
		// Roll back the Supabase account so a failed transaction does not
		// strand an unusable auth user (mirrors deleteUser's care).
		await supabase.auth.admin.deleteUser(authUser.user.id).catch(() => undefined);
		console.error("[superadmin] createPlatformUser error:", e);
		return { error: "Failed to create the user." };
	}
}

export async function updatePlatformUser(
	userId: string,
	data: { displayName?: string; role?: UserRole },
	reason: string,
): Promise<PlatformUserResult> {
	await requirePlatformAdmin();
	const trimmedReason = requireReason(reason);

	try {
		const before = await prisma.user.findUnique({
			where: { id: userId },
			select: { displayName: true, role: true },
		});
		if (!before) return { error: "User not found." };

		const actor = await actorId();
		await prisma.$transaction(async (tx) => {
			await tx.user.update({ where: { id: userId }, data });
			await audit(
				{
					action: "platform.user.update",
					targetId: userId,
					reason: trimmedReason,
					actorUserId: actor,
					before,
					after: { ...before, ...data },
				},
				tx,
			);
		});

		return { success: true, userId };
	} catch (e) {
		console.error("[superadmin] updatePlatformUser error:", e);
		return { error: "Failed to update the user." };
	}
}

export type PlatformUserActionResult =
	| { success: true }
	| { error: string; code?: "step_up_required" };

/** Effectively permanent until enable/purge; Supabase takes a duration string. */
const DISABLE_BAN_DURATION = "876000h";

function stepUpFailure(error: unknown): { error: string; code: "step_up_required" } | null {
	if (!isStepUpRequiredError(error)) return null;
	return { error: error.message, code: "step_up_required" };
}

/** What a disable row recorded, for an exact reversible enable. */
function disabledAuditAfter(after: Prisma.JsonValue | null): {
	revokedMembershipIds: string[];
	platformAdminRevoked: boolean;
	disabledAt: Date | null;
} {
	if (!after || typeof after !== "object" || Array.isArray(after)) {
		return { revokedMembershipIds: [], platformAdminRevoked: false, disabledAt: null };
	}
	const row = after as {
		revokedMembershipIds?: unknown;
		platformAdminRevoked?: unknown;
		disabledAt?: unknown;
	};
	const parsed = typeof row.disabledAt === "string" ? new Date(row.disabledAt) : null;
	return {
		revokedMembershipIds: Array.isArray(row.revokedMembershipIds)
			? row.revokedMembershipIds.filter((id): id is string => typeof id === "string")
			: [],
		platformAdminRevoked: row.platformAdminRevoked === true,
		disabledAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
	};
}

/**
 * Safe user delete (plan M3.10, N3): disable, never purge.
 *
 * The login is banned in Supabase, every active membership is soft-revoked and
 * any platform-admin grant is revoked. Nothing is deleted, so
 * `enablePlatformUser` can restore the exact prior state. A hard purge stays a
 * later M7 job.
 *
 * Requires step-up and a typed farmId confirmation. The auth ban runs inside
 * the step-up-guarded block, and is compensated if the DB transaction fails, so
 * a missing cookie can never ban an account.
 */
export async function disablePlatformUser(
	userId: string,
	reason: string,
	confirmFarmId: string,
): Promise<PlatformUserActionResult> {
	await requirePlatformAdmin();
	const trimmedReason = requireReason(reason);

	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { id: true, farmId: true, supabaseId: true },
	});
	if (!user) return { error: "User not found." };
	if (user.farmId === "superadmin") {
		return { error: "The primary superadmin account cannot be disabled." };
	}
	const typedFarmId = typeof confirmFarmId === "string" ? confirmFarmId.trim() : "";
	if (typedFarmId !== user.farmId) {
		return { error: `Type ${user.farmId} exactly to confirm.` };
	}

	// Last-admin protection: a disable revokes the target's god-mode, so the
	// platform must keep at least one other active admin.
	const grant = await prisma.platformAdmin.findUnique({
		where: { userId },
		select: { revokedAt: true, expiresAt: true },
	});
	if (grant && isPlatformAdminActive(grant)) {
		const activeAdmins = await prisma.platformAdmin.count({
			where: activePlatformAdminWhere(),
		});
		if (activeAdmins <= 1) return { error: LAST_PLATFORM_ADMIN_MESSAGE };
	}

	const actor = await actorId();
	const supabase = createAdminClient();
	let banned = false;

	try {
		await withStepUp(async (stepUpAt) => {
			const { error: authError } = await supabase.auth.admin.updateUserById(user.supabaseId, {
				ban_duration: DISABLE_BAN_DURATION,
			});
			if (authError) {
				throw new Error(`supabase ban failed: ${authError.message}`);
			}
			banned = true;

			await prisma.$transaction(async (tx) => {
				const memberships = await tx.membership.findMany({
					where: { userId: user.id, revokedAt: null },
					select: { id: true, orgId: true, role: true },
				});
				const disabledAt = new Date();
				if (memberships.length > 0) {
					await tx.membership.updateMany({
						where: { id: { in: memberships.map((m) => m.id) } },
						data: { revokedAt: disabledAt },
					});
				}

				const activeGrant = await tx.platformAdmin.findUnique({
					where: { userId: user.id },
					select: { revokedAt: true, expiresAt: true },
				});
				const platformAdminRevoked = Boolean(activeGrant && isPlatformAdminActive(activeGrant));
				if (platformAdminRevoked) {
					await tx.platformAdmin.update({
						where: { userId: user.id },
						data: { revokedAt: disabledAt },
					});
				}

				await audit(
					{
						action: "platform.user.disable",
						targetId: user.id,
						reason: trimmedReason,
						actorUserId: actor,
						stepUpAt,
						before: {
							farmId: user.farmId,
							memberships: memberships.map((m) => ({
								id: m.id,
								orgId: m.orgId,
								role: m.role,
							})),
							platformAdmin: activeGrant
								? {
										expiresAt: activeGrant.expiresAt?.toISOString() ?? null,
										active: platformAdminRevoked,
									}
								: null,
						},
						after: {
							disabledAt: disabledAt.toISOString(),
							revokedMembershipIds: memberships.map((m) => m.id),
							platformAdminRevoked,
						},
					},
					tx,
				);
			});
		});
	} catch (e) {
		if (banned) {
			// Compensate: the DB half failed, so do not leave the login banned.
			await supabase.auth.admin
				.updateUserById(user.supabaseId, { ban_duration: "none" })
				.catch(() => undefined);
		}
		const stepUp = stepUpFailure(e);
		if (stepUp) return stepUp;
		console.error("[superadmin] disablePlatformUser error:", e);
		return { error: "Failed to disable the user." };
	}

	// The account still exists, but its cached farm binding and session entry
	// must not survive the disable.
	invalidateFarm(user.supabaseId);
	return { success: true };
}

/**
 * Reverse a safe disable: unban the login and restore the memberships (and the
 * platform-admin grant, if the disable row recorded one) that it revoked.
 *
 * The append-only audit log is the source of truth for what to restore, so no
 * extra column or migration is needed.
 */
export async function enablePlatformUser(
	userId: string,
	reason: string,
): Promise<PlatformUserActionResult> {
	await requirePlatformAdmin();
	const trimmedReason = requireReason(reason);

	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { id: true, farmId: true, supabaseId: true },
	});
	if (!user) return { error: "User not found." };

	const lastDisable = await prisma.platformAuditLog.findFirst({
		where: { action: "platform.user.disable", targetId: user.id },
		orderBy: { createdAt: "desc" },
		select: { after: true },
	});
	const restore = disabledAuditAfter(lastDisable?.after ?? null);

	const actor = await actorId();
	const supabase = createAdminClient();
	let unbanned = false;

	try {
		await withStepUp(async (stepUpAt) => {
			const { error: authError } = await supabase.auth.admin.updateUserById(user.supabaseId, {
				ban_duration: "none",
			});
			if (authError) {
				throw new Error(`supabase unban failed: ${authError.message}`);
			}
			unbanned = true;

			await prisma.$transaction(async (tx) => {
				if (restore.revokedMembershipIds.length > 0) {
					await tx.membership.updateMany({
						where: {
							id: { in: restore.revokedMembershipIds },
							userId: user.id,
							revokedAt: restore.disabledAt ?? { not: null },
						},
						data: { revokedAt: null },
					});
				}
				if (restore.platformAdminRevoked) {
					await tx.platformAdmin.updateMany({
						where: {
							userId: user.id,
							...(restore.disabledAt ? { revokedAt: restore.disabledAt } : {}),
						},
						data: { revokedAt: null },
					});
				}

				await audit(
					{
						action: "platform.user.enable",
						targetId: user.id,
						reason: trimmedReason,
						actorUserId: actor,
						stepUpAt,
						before: { farmId: user.farmId },
						after: {
							restoredMembershipIds: restore.revokedMembershipIds,
							platformAdminRestored: restore.platformAdminRevoked,
						},
					},
					tx,
				);
			});
		});
	} catch (e) {
		if (unbanned) {
			// The DB half failed; keep the account disabled rather than half-open.
			await supabase.auth.admin
				.updateUserById(user.supabaseId, { ban_duration: DISABLE_BAN_DURATION })
				.catch(() => undefined);
		}
		const stepUp = stepUpFailure(e);
		if (stepUp) return stepUp;
		console.error("[superadmin] enablePlatformUser error:", e);
		return { error: "Failed to enable the user." };
	}

	invalidateFarm(user.supabaseId);
	return { success: true };
}

// ─── Organizations ────────────────────────────────────────────────────────────

export type OrgRow = {
	id: string;
	name: string;
	type: string;
	status: string;
	createdAt: Date;
	memberCount: number;
	pondCount: number;
};

export async function listOrgs(): Promise<OrgRow[]> {
	await requirePlatformAdmin();

	const [orgs, memberships, users] = await Promise.all([
		prisma.organization.findMany({ orderBy: { createdAt: "desc" } }),
		prisma.membership.findMany({ where: { revokedAt: null } }),
		prisma.user.findMany({ select: { id: true, farmId: true } }),
	]);

	if (orgs.length === 0) return [];

	const counts = await activeMemberCounts(orgs.map((o) => o.id));
	const farmIdByUser = new Map(users.map((u) => [u.id, u.farmId]));
	const farmIds = users.map((u) => u.farmId);

	// Ponds hang off farms (Pond.ownerId = User.farmId), so pond totals are
	// resolved from org members rather than a direct orgId on Pond (M1.3).
	const ponds = farmIds.length
		? await prisma.pond.findMany({
				where: { ownerId: { in: farmIds } },
				select: { ownerId: true },
			})
		: [];
	const pondCountByOwner = new Map<string, number>();
	for (const p of ponds) {
		pondCountByOwner.set(p.ownerId, (pondCountByOwner.get(p.ownerId) ?? 0) + 1);
	}

	const pondCountByOrg = new Map<string, number>();
	for (const m of memberships) {
		const farmId = farmIdByUser.get(m.userId);
		if (!farmId) continue;
		const count = pondCountByOwner.get(farmId) ?? 0;
		pondCountByOrg.set(m.orgId, (pondCountByOrg.get(m.orgId) ?? 0) + count);
	}

	return orgs.map((o) => ({
		id: o.id,
		name: o.name,
		type: o.type,
		status: o.status,
		createdAt: o.createdAt,
		memberCount: counts.get(o.id) ?? 0,
		pondCount: pondCountByOrg.get(o.id) ?? 0,
	}));
}

export type CreateOrgResult = { success: true; orgId: string } | { error: string };

export async function createOrg(input: {
	name: string;
	type?: "INDIVIDUAL" | "COOPERATIVE" | "COMPANY" | "LGU" | "ACADEMIC";
	reason: string;
}): Promise<CreateOrgResult> {
	await requirePlatformAdmin();
	const reason = requireReason(input.reason);
	const name = input.name?.trim() ?? "";
	if (!name) return { error: "Organization name is required." };

	try {
		const actor = await actorId();
		const orgId = await prisma.$transaction(async (tx) => {
			const org = await tx.organization.create({
				data: { name, type: input.type ?? "INDIVIDUAL" },
			});
			await audit(
				{
					action: "platform.org.create",
					targetId: org.id,
					reason,
					actorUserId: actor,
					after: { name: org.name, type: org.type },
				},
				tx,
			);
			return org.id;
		});

		return { success: true, orgId };
	} catch (e) {
		console.error("[superadmin] createOrg error:", e);
		return { error: "Failed to create the organization." };
	}
}

// ─── Ponds (read-only) ────────────────────────────────────────────────────────

export type PlatformPondRow = {
	id: string;
	name: string;
	status: string;
	ownerFarmId: string;
	ownerName: string | null;
	orgs: string[];
};

/**
 * Every pond, across every tenant, read-only.
 *
 * Deliberately has no mutation sibling: superadmin cannot interfere in farmer
 * work (3-tier model). It sees ponds for visibility only.
 */
export async function listAllPonds(): Promise<PlatformPondRow[]> {
	await requirePlatformAdmin();

	const [ponds, memberships, orgs] = await Promise.all([
		prisma.pond.findMany({
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				name: true,
				status: true,
				ownerId: true,
				owner: { select: { displayName: true } },
			},
		}),
		prisma.membership.findMany({ where: { revokedAt: null } }),
		prisma.organization.findMany({ select: { id: true, name: true } }),
	]);

	const orgById = new Map(orgs.map((o) => [o.id, o.name]));
	const orgsByUser = new Map<string, string[]>();
	for (const m of memberships) {
		const name = orgById.get(m.orgId);
		if (!name) continue;
		const list = orgsByUser.get(m.userId) ?? [];
		list.push(name);
		orgsByUser.set(m.userId, list);
	}

	return ponds.map((p) => ({
		id: p.id,
		name: p.name,
		status: p.status,
		ownerFarmId: p.ownerId,
		ownerName: p.owner?.displayName ?? null,
		orgs: orgsByUser.get(p.ownerId) ?? [],
	}));
}

// ─── Platform admin grants ────────────────────────────────────────────────────

export type PlatformAdminRow = {
	userId: string;
	farmId: string;
	displayName: string | null;
	grantedBy: string | null;
	grantedAt: Date;
	expiresAt: Date | null;
	revokedAt: Date | null;
	active: boolean;
};

export async function getPlatformAdmins(): Promise<PlatformAdminRow[]> {
	await requirePlatformAdmin();

	const [rows, users] = await Promise.all([
		prisma.platformAdmin.findMany({ orderBy: { createdAt: "desc" } }),
		prisma.user.findMany({ select: { id: true, farmId: true, displayName: true } }),
	]);
	const byId = new Map(users.map((u) => [u.id, u]));

	return rows.map((r) => {
		const u = byId.get(r.userId);
		return {
			userId: r.userId,
			farmId: u?.farmId ?? "(missing user)",
			displayName: u?.displayName ?? null,
			grantedBy: r.grantedBy,
			grantedAt: r.createdAt,
			expiresAt: r.expiresAt,
			revokedAt: r.revokedAt,
			active: isPlatformAdminActive(r),
		};
	});
}

export type GrantResult = { success: true } | { error: string; code?: "step_up_required" };

export async function grantPlatformAdmin(
	userId: string,
	reason: string,
	expiresAt?: string,
): Promise<GrantResult> {
	await requirePlatformAdmin();
	const trimmedReason = requireReason(reason);

	let expiry: Date | null = null;
	if (expiresAt) {
		const parsed = new Date(expiresAt);
		if (Number.isNaN(parsed.getTime())) return { error: "Expiry is not a valid ISO 8601 date." };
		expiry = parsed;
	}

	try {
		const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
		if (!user) return { error: "User not found." };

		const actor = await actorId();
		await withStepUp(async (stepUpAt) => {
			await prisma.$transaction(async (tx) => {
				const existing = await tx.platformAdmin.findUnique({ where: { userId } });
				await tx.platformAdmin.upsert({
					where: { userId },
					update: { revokedAt: null, grantedBy: actor, expiresAt: expiry },
					create: { userId, grantedBy: actor, expiresAt: expiry },
				});
				await audit(
					{
						action: "platform.admin.grant",
						targetId: userId,
						reason: trimmedReason,
						actorUserId: actor,
						stepUpAt,
						temporaryGrant: expiry !== null,
						before: existing
							? {
									revokedAt: existing.revokedAt?.toISOString() ?? null,
									expiresAt: existing.expiresAt?.toISOString() ?? null,
								}
							: undefined,
						after: { expiresAt: expiry?.toISOString() ?? null },
					},
					tx,
				);
			});
		});

		return { success: true };
	} catch (e) {
		const stepUp = stepUpFailure(e);
		if (stepUp) return stepUp;
		console.error("[superadmin] grantPlatformAdmin error:", e);
		return { error: "Failed to grant platform admin." };
	}
}

export async function revokePlatformAdmin(userId: string, reason: string): Promise<GrantResult> {
	await requirePlatformAdmin();
	const trimmedReason = requireReason(reason);

	try {
		const existing = await prisma.platformAdmin.findUnique({ where: { userId } });
		if (!existing) return { error: "That user has no platform admin grant to revoke." };
		if (existing.revokedAt) return { success: true };

		const actor = await actorId();
		// Revoking yourself would immediately strip your own console access.
		if (userId === actor) {
			return { error: "You cannot revoke your own platform admin grant." };
		}

		const targetIsActive = isPlatformAdminActive(existing);
		const refused = await withStepUp(async (stepUpAt) =>
			prisma.$transaction(async (tx) => {
				// Count inside the transaction: two concurrent revokes must not both
				// observe "two admins" and leave the platform with zero.
				if (targetIsActive) {
					const activeAdmins = await tx.platformAdmin.count({
						where: activePlatformAdminWhere(),
					});
					if (activeAdmins <= 1) return true;
				}

				await tx.platformAdmin.update({ where: { userId }, data: { revokedAt: new Date() } });
				await audit(
					{
						action: "platform.admin.revoke",
						targetId: userId,
						reason: trimmedReason,
						actorUserId: actor,
						stepUpAt,
						temporaryGrant: existing.expiresAt !== null,
						before: { expiresAt: existing.expiresAt?.toISOString() ?? null },
					},
					tx,
				);
				return false;
			}),
		);
		if (refused) return { error: LAST_PLATFORM_ADMIN_MESSAGE };

		return { success: true };
	} catch (e) {
		const stepUp = stepUpFailure(e);
		if (stepUp) return stepUp;
		console.error("[superadmin] revokePlatformAdmin error:", e);
		return { error: "Failed to revoke platform admin." };
	}
}
