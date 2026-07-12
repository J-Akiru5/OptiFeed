"use server";

import prisma from "@/lib/prisma";

export interface AuditFilter {
	eventTypes?: string[];
	source?: string;
	dateFrom?: Date;
	dateTo?: Date;
	limit?: number;
	cursor?: string;
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
	nextCursor: string | null;
}

export async function getAuditLog(filters: AuditFilter = {}): Promise<AuditResult> {
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
		select: { id: true },
	});

	if (!pond) {
		return { events: [], nextCursor: null };
	}

	const energyDevices = await prisma.energyDevice.findMany({
		where: { pondId: pond.id },
		select: { id: true },
	});

	if (energyDevices.length === 0) {
		return { events: [], nextCursor: null };
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

	if (filters.cursor) {
		where.createdAt = {
			...(where.createdAt as Record<string, unknown>),
			lt: new Date(filters.cursor),
		};
	}

	const take = filters.limit ?? 50;

	const events = await prisma.deviceStateEvent.findMany({
		where,
		orderBy: { createdAt: "desc" },
		take: take + 1,
		include: {
			device: { select: { id: true, label: true } },
		},
	});

	const hasMore = events.length > take;
	const results = hasMore ? events.slice(0, take) : events;

	return {
		events: results.map((e) => ({
			id: e.id,
			eventType: e.eventType,
			source: e.source,
			actorId: e.actorId,
			deviceTime: e.deviceTime,
			createdAt: e.createdAt,
			metadata: e.metadata as Record<string, unknown> | null,
			device: e.device,
		})),
		nextCursor: hasMore ? results[results.length - 1]?.createdAt.toISOString() : null,
	};
}
