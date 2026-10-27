import { resolveOrgScope } from "@/lib/auth/org-scope";
import { getCurrentPondOwnerId } from "@/lib/auth/session";
import type { Prisma } from "@prisma/client";

/**
 * The pond ids a caller may write calendar events for (E25, #212).
 *
 * Two grants compose:
 * - the caller's own farm (`Pond.ownerId === User.farmId`), which is the
 *   pre-existing farmer scope; and
 * - every pond in an organization where the caller is an active OWNER/ADMIN,
 *   so the tenant admin calendar can edit org-wide events.
 *
 * `resolveOrgScope()` fails closed for members and unwritable orgs, so a plain
 * farmer keeps exactly their old farm scope and an admin never reaches a
 * different organization.
 */
export interface CalendarWriteScope {
	/** `User.farmId` of the acting user (used for `createdBy` / `completedBy`). */
	ownerId: string;
	/** Ponds in organizations the caller administers. Empty for a plain member. */
	orgPondIds: string[];
}

export async function resolveCalendarWriteScope(): Promise<CalendarWriteScope> {
	const [ownerId, orgScope] = await Promise.all([getCurrentPondOwnerId(), resolveOrgScope()]);
	return { ownerId, orgPondIds: orgScope.pondIds };
}

/** Prisma filter for a pond the caller may write. */
export function writablePondWhere(scope: CalendarWriteScope): Prisma.PondWhereInput {
	return scope.orgPondIds.length > 0
		? {
				OR: [{ ownerId: scope.ownerId }, { id: { in: scope.orgPondIds } }],
			}
		: { ownerId: scope.ownerId };
}

/** Prisma filter for a pond event the caller may write. */
export function writablePondEventWhere(scope: CalendarWriteScope): Prisma.PondEventWhereInput {
	return scope.orgPondIds.length > 0
		? {
				OR: [{ pond: { ownerId: scope.ownerId } }, { pondId: { in: scope.orgPondIds } }],
			}
		: { pond: { ownerId: scope.ownerId } };
}
