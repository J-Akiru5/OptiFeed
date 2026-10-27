"use server";

import { getCurrentPondOwnerId } from "@/lib/auth/session";
import { resolvePagination } from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { LIST_PAGE_SIZE_DEFAULT, getListPageSize } from "@/lib/settings/platform";

export interface AuditFilter {
	eventTypes?: string[];
	source?: string;
	dateFrom?: Date;
	dateTo?: Date;
	page?: number;
}

export interface AuditEvent {
	id: string;
	eventType: string;
	source: string;
	actorId: string | null;
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
}

export async function getAuditLog(filters: AuditFilter = {}): Promise<AuditResult> {
	try {
		const pageSize = await getListPageSize();
		const ownerId = await getCurrentPondOwnerId();
		const pond = await prisma.pond.findFirst({
			where: { ownerId, status: "ACTIVE" },
			select: { id: true },
		});

		if (!pond) {
			return { events: [], total: 0, page: 1, pageSize };
		}

		const energyDevices = await prisma.energyDevice.findMany({
			where: { pondId: pond.id },
			select: { id: true },
		});

		if (energyDevices.length === 0) {
			return { events: [], total: 0, page: 1, pageSize };
		}

		const deviceIds = energyDevices.map((d) => d.id);

		const where: Record<string, unknown> = {
			deviceId: { in: deviceIds },
		};

		if (filters.eventTypes && filters.eventTypes.length > 0) {
			where.eventType = { in: filters.eventTypes };
		}

		if (filters.source) {
			where.source = filters.source;
		}

		if (filters.dateFrom || filters.dateTo) {
			where.createdAt = {};
			if (filters.dateFrom) {
				(where.createdAt as Record<string, unknown>).gte = filters.dateFrom;
			}
			if (filters.dateTo) {
				(where.createdAt as Record<string, unknown>).lte = filters.dateTo;
			}
		}

		const requestedPage = Math.max(1, Math.floor(filters.page ?? 1) || 1);
		const [total, firstFetch] = await Promise.all([
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

		return {
			events: rows.map((e) => ({
				id: e.id,
				eventType: e.eventType,
				source: e.source,
				actorId: e.actorId,
				deviceTime: e.deviceTime,
				createdAt: e.createdAt,
				metadata: e.metadata as Record<string, unknown> | null,
				device: e.device,
			})),
			total,
			page: paging.page,
			pageSize: paging.pageSize,
		};
	} catch (error) {
		console.error("Failed to fetch audit log:", error);
		return { events: [], total: 0, page: 1, pageSize: LIST_PAGE_SIZE_DEFAULT };
	}
}
