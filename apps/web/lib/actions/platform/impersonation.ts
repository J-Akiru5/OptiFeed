"use server";

import { actorContext, writePlatformAudit } from "@/lib/actions/platform/audit";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import { isStepUpRequiredError, withStepUp } from "@/lib/auth/step-up";
import {
	VIEW_AS_COOKIE,
	VIEW_AS_MODE,
	VIEW_AS_TTL_MS,
	clearViewAsCookie,
	createViewAsToken,
	getViewAsState,
	setViewAsCookie,
	verifyViewAsToken,
} from "@/lib/auth/view-as";
import prisma from "@/lib/prisma";
import type { MemberRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

/**
 * Read-only view-as lifecycle (plan M5.1, decision D1).
 *
 * Start: platform admin + reason + fresh step-up → one ImpersonationSession
 * (READ_ONLY, 30 minutes) and one PlatformAuditLog start row. The session is
 * scoped to one org and the farm its primary member owns; the dashboard then
 * renders that tenant's data with a red banner while every write guard rejects.
 *
 * Stop: ends the row, audits the stop and clears the cookie. Exit needs no
 * step-up, so an admin can always leave a session even if the grant was
 * revoked mid-way.
 */

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

function requireReason(reason: string | undefined): string {
	const trimmed = reason?.trim() ?? "";
	if (trimmed.length < MIN_REASON_LENGTH) {
		throw new Error(`A reason of at least ${MIN_REASON_LENGTH} characters is required.`);
	}
	return trimmed.slice(0, MAX_REASON_LENGTH);
}

export type StartViewAsResult =
	| { success: true; orgId: string; orgName: string; farmId: string; expiresAt: string }
	| { error: string; code: "step_up_required" }
	| { error: string; code?: undefined };

export type StopViewAsResult = { success: true } | { error: string };

const ROLE_PRIORITY: Record<MemberRole, number> = {
	OWNER: 0,
	ADMIN: 1,
	OPERATOR: 2,
	VIEWER: 3,
};

/**
 * The farm a view-as session renders: the highest-ranked active member's farm,
 * preferring one that actually owns a pond. Deterministic, so the same org
 * always opens the same dashboard.
 */
async function resolveOrgFarmId(orgId: string): Promise<string | null> {
	const memberships = await prisma.membership.findMany({
		where: { orgId, revokedAt: null },
		select: { userId: true, role: true, createdAt: true },
		orderBy: { createdAt: "asc" },
	});
	if (memberships.length === 0) return null;

	const users = await prisma.user.findMany({
		where: { id: { in: [...new Set(memberships.map((m) => m.userId))] } },
		select: { id: true, farmId: true },
	});
	const farmByUser = new Map(users.map((u) => [u.id, u.farmId]));

	const candidates = memberships
		.map((m) => ({
			farmId: farmByUser.get(m.userId) ?? null,
			priority: ROLE_PRIORITY[m.role] ?? 9,
		}))
		.filter((c): c is { farmId: string; priority: number } => Boolean(c.farmId))
		.sort((a, b) => a.priority - b.priority);
	if (candidates.length === 0) return null;

	const farmIds = [...new Set(candidates.map((c) => c.farmId))];
	const ponds = await prisma.pond.findMany({
		where: { ownerId: { in: farmIds } },
		select: { ownerId: true },
	});
	const farmsWithPonds = new Set(ponds.map((p) => p.ownerId));

	return (
		candidates.find((c) => farmsWithPonds.has(c.farmId))?.farmId ?? candidates[0]?.farmId ?? null
	);
}

/**
 * Open a read-only view-as session for an ACTIVE organization.
 *
 * Any session this admin already has open is closed first (and audited), so
 * only one view-as is ever live per browser and no row is left dangling.
 */
export async function startViewAs(input: {
	orgId: string;
	reason: string;
}): Promise<StartViewAsResult> {
	await requirePlatformAdmin();

	let reason: string;
	try {
		reason = requireReason(input.reason);
	} catch (e) {
		return { error: e instanceof Error ? e.message : "A reason is required." };
	}
	if (typeof input.orgId !== "string" || !input.orgId) {
		return { error: "Choose an organization." };
	}

	try {
		const org = await prisma.organization.findFirst({
			where: { id: input.orgId, status: "ACTIVE" },
			select: { id: true, name: true },
		});
		if (!org) return { error: "Choose an active organization." };

		const farmId = await resolveOrgFarmId(org.id);
		if (!farmId) {
			return {
				error: "This organization has no farm to view yet. Add a member with a farm first.",
			};
		}

		const actor = await actorContext();
		const now = new Date();
		const expiresAt = new Date(now.getTime() + VIEW_AS_TTL_MS);

		const sessionId = await withStepUp(async (stepUpAt) => {
			return prisma.$transaction(async (tx) => {
				const open = await tx.impersonationSession.findMany({
					where: { actorUserId: actor.id, endedAt: null },
					select: { id: true, orgId: true, reason: true },
				});
				if (open.length > 0) {
					await tx.impersonationSession.updateMany({
						where: { id: { in: open.map((s) => s.id) } },
						data: { endedAt: now },
					});
					for (const previous of open) {
						await writePlatformAudit(tx, {
							actorUserId: actor.id,
							action: "platform.impersonation.stop",
							targetType: "organization",
							targetId: previous.orgId,
							orgId: previous.orgId,
							reason: `Superseded by a new view-as session: ${previous.reason}`.slice(
								0,
								MAX_REASON_LENGTH,
							),
							impersonationId: previous.id,
							after: { endedAt: now.toISOString(), superseded: true },
						});
					}
				}

				const session = await tx.impersonationSession.create({
					data: {
						actorUserId: actor.id,
						orgId: org.id,
						mode: VIEW_AS_MODE,
						reason,
						startedAt: now,
						expiresAt,
					},
					select: { id: true },
				});

				await writePlatformAudit(tx, {
					actorUserId: actor.id,
					action: "platform.impersonation.start",
					targetType: "organization",
					targetId: org.id,
					orgId: org.id,
					reason,
					stepUpAt,
					temporaryGrant: actor.temporaryGrant,
					impersonationId: session.id,
					after: { mode: VIEW_AS_MODE, farmId, expiresAt: expiresAt.toISOString() },
				});

				return session.id;
			});
		});

		const token = createViewAsToken(
			{ sid: sessionId, actorUserId: actor.id, orgId: org.id, farmId },
			now,
		);
		await setViewAsCookie(token, expiresAt);

		revalidatePath("/[locale]/(dashboard)/dashboard", "page");
		return {
			success: true,
			orgId: org.id,
			orgName: org.name,
			farmId,
			expiresAt: expiresAt.toISOString(),
		};
	} catch (e) {
		if (isStepUpRequiredError(e)) {
			return { error: e.message, code: "step_up_required" };
		}
		console.error(
			"[platform] startViewAs error:",
			e instanceof Error ? e.message : "unknown error",
		);
		return { error: "Failed to start the view-as session." };
	}
}

/**
 * End the caller's view-as session. Safe to call with no session: the cookie
 * is cleared either way, so a stuck banner cannot trap the admin.
 */
export async function stopViewAs(): Promise<StopViewAsResult> {
	try {
		const user = await getCurrentUser();
		if (!user) {
			await clearViewAsCookie();
			return { error: "Not authenticated." };
		}

		// Verify against the signature only: an expired or already-ended session
		// still needs its cookie cleared and its row closed. `allowExpired` never
		// makes the token usable for reads or writes; it only lets exit finish
		// the bookkeeping after the 30-minute window.
		const cookieStore = await cookies();
		const verification = verifyViewAsToken(
			cookieStore.get(VIEW_AS_COOKIE)?.value,
			user.id,
			new Date(),
			{
				allowExpired: true,
			},
		);
		if (verification.valid) {
			const session = await prisma.impersonationSession.findUnique({
				where: { id: verification.payload.sid },
				select: {
					id: true,
					actorUserId: true,
					orgId: true,
					reason: true,
					endedAt: true,
				},
			});
			if (session && session.actorUserId === user.id && !session.endedAt) {
				const now = new Date();
				await prisma.$transaction(async (tx) => {
					await tx.impersonationSession.update({
						where: { id: session.id },
						data: { endedAt: now },
					});
					await writePlatformAudit(tx, {
						actorUserId: user.id,
						action: "platform.impersonation.stop",
						targetType: "organization",
						targetId: session.orgId,
						orgId: session.orgId,
						reason: `View-as ended: ${session.reason}`.slice(0, MAX_REASON_LENGTH),
						impersonationId: session.id,
						after: { endedAt: now.toISOString() },
					});
				});
			}
		}

		await clearViewAsCookie();
		revalidatePath("/[locale]/(dashboard)/dashboard", "page");
		return { success: true };
	} catch (e) {
		console.error("[platform] stopViewAs error:", e instanceof Error ? e.message : "unknown error");
		await clearViewAsCookie();
		return { error: "Failed to end the view-as session." };
	}
}

export type ViewAsBannerState = {
	orgName: string;
	reason: string;
	expiresAt: Date;
} | null;

/**
 * Banner data for the tenant dashboard layout. Returns null unless a live,
 * unexpired READ_ONLY session exists for the caller.
 */
export async function getViewAsBanner(): Promise<ViewAsBannerState> {
	const state = await getViewAsState();
	if (!state.active) return null;

	try {
		const org = await prisma.organization.findUnique({
			where: { id: state.orgId },
			select: { name: true },
		});
		return {
			orgName: org?.name ?? "tenant",
			reason: state.reason,
			expiresAt: state.expiresAt,
		};
	} catch {
		return null;
	}
}
