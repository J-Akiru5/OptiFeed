import type { Prisma } from "@prisma/client";

/**
 * Farmer Audit Trail helpers (issue #273, worker I-50).
 *
 * Pure, unit-testable logic for the farmer page:
 * - the tenant-scoped `where` clause (all active ponds owned by the caller);
 * - actor-id resolution, including the two id conventions in the event table;
 * - the "user touched this" predicate behind the Last touch card;
 * - a bounded, React-safe metadata preview.
 *
 * Nothing here touches the database or the session; `lib/actions/audit.ts`
 * supplies both. The visibility matrix is documented here so the boundary is
 * reviewable next to the code that enforces it.
 */

/**
 * RBAC equivalence for audit reads. Each surface has exactly one scope and
 * must not widen beyond it:
 *
 * | Caller         | Surface                              | Scope                 |
 * | -------------- | ------------------------------------ | --------------------- |
 * | Farmer         | `/dashboard/audit` (this page)       | own farm's ponds      |
 * | Tenant admin   | `/admin/audit`                       | organization          |
 * | Platform admin | `/superadmin/operations/audit`       | platform audit table  |
 *
 * The farmer action resolves the caller with `getCurrentPondOwnerId()` and
 * filters ponds by that owner; it never calls `resolveOrgScope()` or reads
 * `PlatformAuditLog`. Actor names are resolved only for users whose `farmId`
 * matches the caller's farm, so a foreign actor id falls back to the raw id
 * instead of leaking another farm's display name.
 */
export const AUDIT_VISIBILITY_MATRIX = {
	farmer: {
		surface: "/dashboard/audit",
		scope: "own_farm",
		gate: "getCurrentPondOwnerId()",
		events: "DeviceStateEvent for active ponds owned by the caller",
	},
	tenantAdmin: {
		surface: "/admin/audit",
		scope: "organization",
		gate: "requireTenantAdmin() + resolveOrgScope()",
		events: "DeviceStateEvent for every pond in the admin's active organizations",
	},
	platformAdmin: {
		surface: "/superadmin/operations/audit",
		scope: "platform",
		gate: "requirePlatformAdmin()",
		events: "PlatformAuditLog rows",
	},
} as const;

/** Longest metadata preview rendered in the Details block. */
export const AUDIT_METADATA_LIMIT = 2_000;

export interface AuditFilterInput {
	eventTypes?: string[];
	source?: string;
	dateFrom?: Date;
	dateTo?: Date;
}

export interface AuditActorIdentity {
	id: string;
	farmId: string;
	email: string;
	displayName: string | null;
	role: string;
}

export interface ActorFallbackLabels {
	system: string;
	device: string;
	unknown: string;
}

/**
 * The `where` clause shared by the list, its count and the Last touch query.
 *
 * Scope is the set of active pond ids the caller owns. The device relation is
 * used instead of an unbounded `deviceId IN (...)`, so adding a pond or feeder
 * cannot silently fall outside the audit trail.
 *
 * `userTouchedOnly` narrows to rows with an actor id or a `user` source — the
 * definition of a human touch used by the summary card.
 */
export function buildAuditWhere(
	pondIds: readonly string[],
	filters: AuditFilterInput = {},
	options: { userTouchedOnly?: boolean } = {},
): Prisma.DeviceStateEventWhereInput {
	const where: Prisma.DeviceStateEventWhereInput = {
		device: { pondId: { in: [...pondIds] } },
	};

	if (filters.eventTypes && filters.eventTypes.length > 0) {
		where.eventType = { in: [...filters.eventTypes] };
	}

	if (filters.source) {
		where.source = filters.source;
	}

	if (filters.dateFrom || filters.dateTo) {
		where.createdAt = {
			...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
			...(filters.dateTo ? { lte: filters.dateTo } : {}),
		};
	}

	if (options.userTouchedOnly) {
		where.OR = [{ actorId: { not: null } }, { source: "user" }];
	}

	return where;
}

/**
 * True when an event records a human touch.
 *
 * Some writers store the actor's `farmId` (login slug) rather than `User.id`,
 * so a non-null actor id is necessary but not sufficient to resolve a name;
 * `indexAuditActors` handles both conventions.
 */
export function isUserTouch(event: { actorId: string | null; source: string }): boolean {
	return event.actorId !== null || event.source === "user";
}

/** Distinct, non-empty actor ids from the page plus the Last touch row. */
export function actorLookupKeys(actorIds: readonly (string | null | undefined)[]): string[] {
	return [
		...new Set(actorIds.filter((id): id is string => typeof id === "string" && id.length > 0)),
	];
}

/**
 * Index actors by both `User.id` and `User.farmId`.
 *
 * `DeviceStateEvent.actorId` is written as a user id in some paths and as the
 * farm login slug (`ownerId`) in others. Looking up both is what makes the
 * label human-readable without a schema migration.
 */
export function indexAuditActors(
	actors: readonly AuditActorIdentity[],
): Map<string, AuditActorIdentity> {
	const byKey = new Map<string, AuditActorIdentity>();
	for (const actor of actors) {
		byKey.set(actor.id, actor);
		byKey.set(actor.farmId, actor);
	}
	return byKey;
}

/** Display name, then email, then the farm login slug; null when unresolved. */
export function labelForActor(actor: AuditActorIdentity | undefined): string | null {
	if (!actor) return null;
	const name = actor.displayName?.trim();
	return name && name.length > 0 ? name : actor.email || actor.farmId || null;
}

/**
 * Label to render for an event.
 *
 * Precedence required by #273: resolved label, then the raw id (set by the
 * action when a user row is missing or outside the tenant), then a translated
 * source fallback. Never invent a name for an unresolved actor.
 */
export function displayActorLabel(
	event: { actorId: string | null; source: string; actorLabel: string | null },
	labels: ActorFallbackLabels,
): string {
	if (event.actorLabel) return event.actorLabel;
	if (event.source === "system") return labels.system;
	if (event.source === "device") return labels.device;
	return labels.unknown;
}

/**
 * Pretty-print metadata for a `<pre>` block, capped at `limit` characters.
 *
 * The result is plain text. The page renders it as a React child, so `<`, `>`
 * and quotes are escaped by React; this function must never return HTML or be
 * used with `dangerouslySetInnerHTML`.
 */
export function formatAuditMetadata(
	metadata: unknown,
	limit: number = AUDIT_METADATA_LIMIT,
): string | null {
	if (metadata === null || metadata === undefined) return null;

	let text: string;
	try {
		text = JSON.stringify(metadata, null, 2) ?? String(metadata);
	} catch {
		return "[unserializable metadata]";
	}
	if (text.length === 0) return null;

	const cap = Math.max(1, Math.floor(limit));
	if (text.length <= cap) return text;
	return `${text.slice(0, cap - 1)}…`;
}
