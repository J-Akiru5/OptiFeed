import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import {
	type StepUpRequirement,
	actionForAuditCode,
	sensitiveAuditActions,
} from "@/lib/platform/sensitive-actions-rules";
import prisma from "@/lib/prisma";

/**
 * Security and oversight read model (plan M3C.7).
 *
 * Reads the append-only platform audit table for the actions the catalog marks
 * as sensitive and reports, per row, whether a step-up credential was present at
 * the time. It is not a second audit log and writes nothing: the audit table
 * stays the single source of truth.
 *
 * The read is bounded (`OVERSIGHT_ROW_LIMIT`) and isolated: a failing source
 * returns `sourceError: true` with no rows, so the panel can say it could not
 * read rather than rendering an empty, healthy-looking history.
 */

export const OVERSIGHT_ROW_LIMIT = 20;

export interface OversightRow {
	id: string;
	createdAt: Date;
	auditAction: string;
	actionId: string | null;
	requirement: StepUpRequirement | null;
	stepUpAt: Date | null;
	actorLabel: string;
	orgName: string | null;
	targetType: string;
	targetId: string | null;
	reason: string;
}

export interface OversightResult {
	rows: OversightRow[];
	/** True when the audit read failed; rows is empty in that case. */
	sourceError: boolean;
	/** Step-up actions whose audit row recorded no step-up timestamp. */
	missingStepUp: number;
}

function failed(): OversightResult {
	return { rows: [], sourceError: true, missingStepUp: 0 };
}

export async function getSecurityOversight(): Promise<OversightResult> {
	await requirePlatformAdmin();

	const auditActions = sensitiveAuditActions();
	if (auditActions.length === 0) return { rows: [], sourceError: false, missingStepUp: 0 };

	try {
		const rows = await prisma.platformAuditLog.findMany({
			where: { action: { in: auditActions } },
			orderBy: { createdAt: "desc" },
			take: OVERSIGHT_ROW_LIMIT,
			select: {
				id: true,
				createdAt: true,
				actorUserId: true,
				action: true,
				targetType: true,
				targetId: true,
				orgId: true,
				reason: true,
				stepUpAt: true,
			},
		});

		const actorIds = [...new Set(rows.map((row) => row.actorUserId))];
		const orgIds = [...new Set(rows.flatMap((row) => (row.orgId ? [row.orgId] : [])))];

		const [actors, orgs] = await Promise.all([
			actorIds.length > 0
				? prisma.user.findMany({
						where: { id: { in: actorIds } },
						take: actorIds.length,
						select: { id: true, email: true, displayName: true },
					})
				: [],
			orgIds.length > 0
				? prisma.organization.findMany({
						where: { id: { in: orgIds } },
						take: orgIds.length,
						select: { id: true, name: true },
					})
				: [],
		]);

		const actorById = new Map(actors.map((actor) => [actor.id, actor]));
		const orgById = new Map(orgs.map((org) => [org.id, org]));

		const mapped: OversightRow[] = rows.map((row) => {
			const actor = actorById.get(row.actorUserId);
			const entry = actionForAuditCode(row.action);
			return {
				id: row.id,
				createdAt: row.createdAt,
				auditAction: row.action,
				actionId: entry?.id ?? null,
				requirement: entry?.requirement ?? null,
				stepUpAt: row.stepUpAt,
				actorLabel: actor?.displayName || actor?.email || row.actorUserId,
				orgName: row.orgId ? (orgById.get(row.orgId)?.name ?? null) : null,
				targetType: row.targetType,
				targetId: row.targetId,
				reason: row.reason,
			};
		});

		return {
			rows: mapped,
			sourceError: false,
			missingStepUp: mapped.filter((row) => row.requirement === "step-up" && !row.stepUpAt).length,
		};
	} catch {
		return failed();
	}
}
