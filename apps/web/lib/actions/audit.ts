"use server";

import {
	type AuditFilterInput,
	actorLookupKeys,
	buildAuditWhere,
	indexAuditActors,
	isUserTouch,
	labelForActor,
} from "@/lib/audit/trail";
import { getCurrentPondOwnerId } from "@/lib/auth/session";
import { resolvePagination } from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { LIST_PAGE_SIZE_DEFAULT, getListPageSize } from "@/lib/settings/platform";

export interface AuditFilter extends AuditFilterInput {
	page?: number;
}

export interface AuditEvent {
	id: string;
	eventType: string;
	source: string;
	actorId: string | null;
	/** Resolved display name/email, or the raw actor id when no user row is visible. */
	actorLabel: string | null;
	actorRole: string | null;
	actorFarmId: string | null;
	deviceTime: string | null;
	createdAt: Date;
	metadata: Record<string, unknown> | null;
	device: { id: string; label: string };
}

export interface AuditResult {
	events: AuditEvent[];
	total: number;
	page: number;
	pageSize: number;
	/** Newest user-touched event in the current filter scope, if any. */
	lastTouch: AuditEvent | null;
}

function emptyResult(pageSize: number): AuditResult {
	return { events: [], total: 0, page: 1, pageSize, lastTouch: null };
}

/**
 * Farmer audit trail (#273).
 *
 * Scope: every ACTIVE pond owned by the caller, never one arbitrary pond. The
 * device relation filter keeps the tenant boundary (a device belongs to a
 * pond; the pond list is owner-scoped). Actor ids are resolved in one batch
 * query per page and only for users on the caller's farm; an actor outside
 * that boundary stays a raw id so another farm's name is never exposed.
 *
 * "Last touch" is a separate first-row query so it still finds the newest
 * human action when the current page is full of device heartbeats.
 */
export async function getAuditLog(filters: AuditFilter = {}): Promise<AuditResult> {
	try {
		const pageSize = await getListPageSize();
		const ownerId = await getCurrentPondOwnerId();
		const ponds = await prisma.pond.findMany({
			where: { ownerId, status: "ACTIVE" },
			select: { id: true },
		});

		if (ponds.length === 0) {
			return emptyResult(pageSize);
		}

		const pondIds = ponds.map((pond) => pond.id);
		const where = buildAuditWhere(pondIds, filters);

		const requestedPage = Math.max(1, Math.floor(filters.page ?? 1) || 1);
		const [total, firstFetch, lastTouchRow] = await Promise.all([
			prisma.deviceStateEvent.count({ where }),
			prisma.deviceStateEvent.findMany({
				where,
				orderBy: { id: "desc" },
				skip: (requestedPage - 1) * pageSize,
				take: pageSize,
				include: {
					device: { select: { id: true, label: true } },
				},
			}),
			prisma.deviceStateEvent.findFirst({
				where: buildAuditWhere(pondIds, filters, { userTouchedOnly: true }),
				orderBy: { id: "desc" },
				include: {
					device: { select: { id: true, label: true } },
				},
			}),
		]);
		const paging = resolvePagination(requestedPage, pageSize, total);
		const rows =
			paging.page === requestedPage
				? firstFetch
				: await prisma.deviceStateEvent.findMany({
						where,
						orderBy: { id: "desc" },
						skip: paging.offset,
						take: paging.pageSize,
						include: {
							device: { select: { id: true, label: true } },
						},
					});

		// One actor query per page. `farmId: ownerId` is the tenant boundary:
		// an id belonging to another farm resolves to nothing and stays raw.
		const actorKeys = actorLookupKeys([
			...rows.map((row) => row.actorId),
			lastTouchRow?.actorId ?? null,
		]);
		const actors =
			actorKeys.length > 0
				? await prisma.user.findMany({
						where: {
							farmId: ownerId,
							OR: [{ id: { in: actorKeys } }, { farmId: { in: actorKeys } }],
						},
						take: actorKeys.length,
						select: {
							id: true,
							farmId: true,
							email: true,
							displayName: true,
							role: true,
						},
					})
				: [];
		const actorByKey = indexAuditActors(actors);

		const toEvent = (event: (typeof rows)[number]): AuditEvent => {
			const actor = event.actorId ? actorByKey.get(event.actorId) : undefined;
			return {
				id: event.id,
				eventType: event.eventType,
				source: event.source,
				actorId: event.actorId,
				actorLabel: labelForActor(actor) ?? event.actorId,
				actorRole: actor?.role ?? null,
				actorFarmId: actor?.farmId ?? null,
				deviceTime: event.deviceTime,
				createdAt: event.createdAt,
				metadata: event.metadata as Record<string, unknown> | null,
				device: event.device,
			};
		};

		return {
			events: rows.map(toEvent),
			total,
			page: paging.page,
			pageSize: paging.pageSize,
			lastTouch: lastTouchRow && isUserTouch(lastTouchRow) ? toEvent(lastTouchRow) : null,
		};
	} catch (error) {
		console.error("Failed to fetch audit log:", error);
		return emptyResult(LIST_PAGE_SIZE_DEFAULT);
	}
}
