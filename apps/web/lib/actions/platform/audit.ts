import { getCurrentUser } from "@/lib/auth/session";
import { parseClientIp } from "@/lib/client-ip";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";

/**
 * Shared plumbing for platform audit rows (plan M3.9, §4.4).
 *
 * `lib/actions/platform/devices.ts`, `lib/actions/superadmin.ts` and the
 * view-as actions all need the acting admin, the request origin and one
 * PlatformAuditLog row. Keeping the shape in one place means a new platform
 * action cannot quietly omit `ip`, `userAgent` or `temporaryGrant`.
 *
 * This module is deliberately not a server-action module: it is imported by
 * server actions and by their tests, and nothing here is callable from the
 * browser.
 */

/**
 * Request origin for the audit row (who/what/when/where).
 *
 * The address comes from `lib/client-ip.ts`, the same trusted-hop derivation
 * the login rate limiter uses: only the final `x-forwarded-for` entry is
 * trusted (Vercel's edge, one proxy — see that module). A missing or malformed
 * header records `null`; the audit trail must not claim an address it did not
 * observe, and must not fall back to a client-supplied header such as
 * `x-real-ip`.
 */
export async function requestOrigin(): Promise<{ ip: string | null; userAgent: string | null }> {
	try {
		const h = await headers();
		return {
			ip: parseClientIp(h.get("x-forwarded-for")),
			userAgent: h.get("user-agent")?.slice(0, 512) ?? null,
		};
	} catch {
		return { ip: null, userAgent: null };
	}
}

/**
 * The acting platform admin, and whether they act on a time-boxed demo grant
 * (plan T10): such rows are flagged so the audit explorer can tell them apart.
 */
export async function actorContext(): Promise<{ id: string; temporaryGrant: boolean }> {
	const user = await getCurrentUser();
	if (!user) throw new Error("Not authenticated.");
	const grant = await prisma.platformAdmin.findUnique({
		where: { userId: user.id },
		select: { expiresAt: true },
	});
	return { id: user.id, temporaryGrant: Boolean(grant?.expiresAt) };
}

export type PlatformAuditInput = {
	actorUserId: string;
	action: string;
	targetType: string;
	targetId?: string | null;
	/** Org context where the action has one (plan M3.9). */
	orgId?: string | null;
	reason: string;
	/** When the dangerous action's password check happened (M3.2). */
	stepUpAt?: Date | null;
	temporaryGrant?: boolean;
	/** Set for actions performed inside a view-as session (M5.1). */
	impersonationId?: string | null;
	before?: Prisma.InputJsonValue;
	after?: Prisma.InputJsonValue;
};

/** Append one audit row. Call inside the same transaction as the mutation. */
export async function writePlatformAudit(
	tx: Prisma.TransactionClient,
	data: PlatformAuditInput,
): Promise<void> {
	const origin = await requestOrigin();
	await tx.platformAuditLog.create({
		data: {
			actorUserId: data.actorUserId,
			action: data.action,
			targetType: data.targetType,
			targetId: data.targetId ?? null,
			orgId: data.orgId ?? null,
			reason: data.reason,
			stepUpAt: data.stepUpAt ?? null,
			temporaryGrant: data.temporaryGrant ?? false,
			impersonationId: data.impersonationId ?? null,
			ip: origin.ip,
			userAgent: origin.userAgent,
			...(data.before !== undefined ? { before: data.before } : {}),
			...(data.after !== undefined ? { after: data.after } : {}),
		},
	});
}
