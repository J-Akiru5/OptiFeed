"use server";

import { actorContext, writePlatformAudit } from "@/lib/actions/platform/audit";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import {
	type PlatformIncidentAction,
	type PlatformIncidentEventType,
	type PlatformIncidentStatus,
	escalationAckDueAt,
	eventTypeForAction,
	targetStatusForAction,
} from "@/lib/platform/incident-lifecycle-rules";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

/**
 * Operator actions on a stored platform incident (issue #479, M3C.6).
 *
 * Acknowledge, investigate, resolve and escalate. Every action:
 *  - is gated by an active `PlatformAdmin` row (`requirePlatformAdmin`);
 *  - requires a written reason of at least 10 characters;
 *  - is validated by the pure transition rules, so an illegal move is refused
 *    here even if a caller bypasses the page;
 *  - writes the transition `PlatformIncidentEvent` (and the in-app `NOTIFIED`
 *    event on escalation) plus one `PlatformAuditLog` row in the same
 *    transaction as the status write.
 *
 * Escalation is in-app only (plan decision O20): it assigns a named platform
 * admin, sets `ackDueAt = now + 30 min`, and records a `NOTIFIED` event for the
 * platform-admin role. No email, chat or pager channel exists.
 *
 * These actions do not touch a tenant's data, so they carry a reason and an
 * audit row rather than a step-up credential. Step-up stays reserved for the
 * actions the sensitive-action catalog marks as reaching a tenant's fleet,
 * people or data.
 */

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

export type PlatformIncidentActionCode =
	| "invalid_transition"
	| "not_found"
	| "owner_required"
	| "owner_invalid"
	| "reason"
	| "conflict";

export type PlatformIncidentActionResult =
	| { success: true; status: PlatformIncidentStatus }
	| { error: string; code: PlatformIncidentActionCode };

class IncidentConflictError extends Error {}

function parseReason(reason: string | undefined): string | null {
	const trimmed = reason?.trim() ?? "";
	if (trimmed.length < MIN_REASON_LENGTH) return null;
	return trimmed.slice(0, MAX_REASON_LENGTH);
}

function revalidateIncidentSurfaces(incidentId: string): void {
	revalidatePath("/[locale]/(superadmin)/superadmin/incidents", "page");
	revalidatePath(`/[locale]/(superadmin)/superadmin/incidents/${incidentId}`, "page");
}

async function applyTransition(input: {
	incidentId: string;
	action: PlatformIncidentAction;
	reason: string | undefined;
	ownerId?: string;
}): Promise<PlatformIncidentActionResult> {
	await requirePlatformAdmin();

	const reason = parseReason(input.reason);
	if (!reason) {
		return {
			error: `A reason of at least ${MIN_REASON_LENGTH} characters is required.`,
			code: "reason",
		};
	}

	const now = new Date();
	const incident = await prisma.platformIncident.findUnique({
		where: { id: input.incidentId },
		select: {
			id: true,
			status: true,
			orgId: true,
		},
	});
	if (!incident) return { error: "Incident not found.", code: "not_found" };

	const to = targetStatusForAction(input.action, incident.status);
	if (!to) {
		return {
			error: `An incident in ${incident.status} cannot be ${input.action}d.`,
			code: "invalid_transition",
		};
	}

	let ownerId: string | null = null;
	let ackDueAt: Date | null = null;

	if (input.action === "escalate") {
		if (!input.ownerId) {
			return { error: "Choose a platform-admin owner to escalate to.", code: "owner_required" };
		}
		const grant = await prisma.platformAdmin.findUnique({
			where: { userId: input.ownerId },
			select: { revokedAt: true, expiresAt: true },
		});
		const active =
			grant !== null &&
			grant.revokedAt === null &&
			(grant.expiresAt === null || grant.expiresAt.getTime() > now.getTime());
		if (!active) {
			return {
				error: "The chosen owner no longer has an active platform-admin grant.",
				code: "owner_invalid",
			};
		}
		ownerId = input.ownerId;
		ackDueAt = escalationAckDueAt(now);
	}

	const type: PlatformIncidentEventType = eventTypeForAction(input.action);
	const actor = await actorContext();

	const updatedData: Prisma.PlatformIncidentUpdateManyMutationInput = { status: to };
	if (input.action === "acknowledge") updatedData.acknowledgedAt = now;
	if (input.action === "resolve") updatedData.resolvedAt = now;
	if (input.action === "escalate") {
		updatedData.ownerId = ownerId;
		updatedData.escalatedAt = now;
		updatedData.ackDueAt = ackDueAt;
	}

	const eventMetadata: Record<string, unknown> = { action: input.action };
	if (input.action === "escalate") {
		eventMetadata.ownerId = ownerId;
		eventMetadata.ackDueAt = ackDueAt?.toISOString() ?? null;
	}

	try {
		await prisma.$transaction(async (tx) => {
			// Optimistic guard: two operators cannot both move the same status.
			const updated = await tx.platformIncident.updateMany({
				where: { id: incident.id, status: incident.status },
				data: updatedData,
			});
			if (updated.count !== 1) throw new IncidentConflictError("incident changed");

			await tx.platformIncidentEvent.create({
				data: {
					incidentId: incident.id,
					type,
					fromStatus: incident.status,
					toStatus: to,
					actorId: actor.id,
					note: reason,
					metadata: eventMetadata as Prisma.InputJsonValue,
				},
			});

			if (input.action === "escalate") {
				await tx.platformIncidentEvent.create({
					data: {
						incidentId: incident.id,
						type: "NOTIFIED",
						fromStatus: to,
						toStatus: to,
						actorId: actor.id,
						note: "The platform-admin role was notified in the console. No external channel is used.",
						metadata: {
							channel: "in_app",
							audience: "platform_admin",
							ownerId,
							ackDueAt: ackDueAt?.toISOString() ?? null,
						} as Prisma.InputJsonValue,
					},
				});
			}

			await writePlatformAudit(tx, {
				actorUserId: actor.id,
				action: `platform.incident.${input.action}`,
				targetType: "platform_incident",
				targetId: incident.id,
				orgId: incident.orgId,
				reason,
				temporaryGrant: actor.temporaryGrant,
				before: { status: incident.status } as Prisma.InputJsonValue,
				after: {
					status: to,
					...(input.action === "escalate"
						? { ownerId, ackDueAt: ackDueAt?.toISOString() ?? null }
						: {}),
				} as Prisma.InputJsonValue,
			});
		});
	} catch (error) {
		if (error instanceof IncidentConflictError) {
			return {
				error: "The incident changed while you were working. Reload and try again.",
				code: "conflict",
			};
		}
		console.error(
			"[platform] incident action failed:",
			error instanceof Error ? error.message : "unknown error",
		);
		return { error: "The incident action failed.", code: "invalid_transition" };
	}

	revalidateIncidentSurfaces(incident.id);
	return { success: true, status: to };
}

export async function acknowledgePlatformIncident(input: {
	incidentId: string;
	reason: string;
}): Promise<PlatformIncidentActionResult> {
	return applyTransition({ ...input, action: "acknowledge" });
}

export async function investigatePlatformIncident(input: {
	incidentId: string;
	reason: string;
}): Promise<PlatformIncidentActionResult> {
	return applyTransition({ ...input, action: "investigate" });
}

export async function resolvePlatformIncident(input: {
	incidentId: string;
	reason: string;
}): Promise<PlatformIncidentActionResult> {
	return applyTransition({ ...input, action: "resolve" });
}

export async function escalatePlatformIncident(input: {
	incidentId: string;
	ownerId: string;
	reason: string;
}): Promise<PlatformIncidentActionResult> {
	return applyTransition({ ...input, action: "escalate" });
}
