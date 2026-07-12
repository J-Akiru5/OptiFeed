import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Devices are considered disconnected if no heartbeat for 15 minutes.
// Matches the dashboard's offline threshold.
const OFFLINE_THRESHOLD_MS = 15 * 60 * 1000;

// How far back to search for orphaned FeedRequests during reconciliation.
const RECONCILIATION_LOOKBACK_HOURS = 4;

const RATE_LIMIT_MS = 1000;

const baseSchema = z.object({
	device_id: z.string().min(1),
	event_type: z.enum(["heartbeat", "feed_dispensed", "schedule_acked"]),
	timestamp: z.string().min(1),
	event_id: z.string().min(8).optional(),
});

const heartbeatSchema = baseSchema.extend({
	rtc_ok: z.boolean(),
	feeder_active: z.boolean(),
});

const feedDispensedSchema = baseSchema.extend({
	grams: z.number().positive(),
	source: z.enum(["scheduled", "dashboard", "button"]),
	feed_request_id: z.string().nullable().optional(),
});

const scheduleAckedSchema = baseSchema.extend({
	command_id: z.string().min(1),
});

function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function now(): Date {
	return new Date();
}

export async function POST(request: Request) {
	const token = request.headers.get("x-device-token");
	if (!token) {
		return new Response("Unauthorized", { status: 401 });
	}

	const device = await prisma.energyDevice.findUnique({
		where: { token },
		select: { id: true, mac: true, lastSeenAt: true, pondId: true, label: true },
	});

	if (!device) {
		return new Response("Unauthorized", { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return new Response("Unprocessable Entity", { status: 422 });
	}

	const baseParsed = baseSchema.safeParse(body);
	if (!baseParsed.success) {
		return new Response("Unprocessable Entity", { status: 422 });
	}

	if (baseParsed.data.device_id !== device.mac) {
		return new Response("Unauthorized", { status: 401 });
	}

	if (device.lastSeenAt && Date.now() - device.lastSeenAt.getTime() < RATE_LIMIT_MS) {
		return new Response("Too Many Requests", { status: 429 });
	}

	const eventType = baseParsed.data.event_type;
	const eventId = baseParsed.data.event_id ?? null;

	if (eventType === "heartbeat") {
		const parsed = heartbeatSchema.safeParse(body);
		if (!parsed.success) {
			return new Response("Unprocessable Entity", { status: 422 });
		}

		const wasOffline =
			!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS;

		try {
			const operations: Prisma.PrismaPromise<unknown>[] = [
				prisma.energyDevice.update({
					where: { id: device.id },
					data: {
						lastSeenAt: new Date(),
						rtcOk: parsed.data.rtc_ok,
						feederActive: parsed.data.feeder_active,
					},
				}),
				prisma.feedEvent.create({
					data: {
						deviceId: device.id,
						eventId,
						eventType: "heartbeat",
						timestamp: parsed.data.timestamp,
						rtcOk: parsed.data.rtc_ok,
						feederActive: parsed.data.feeder_active,
					},
				}),
				prisma.deviceStateEvent.create({
					data: {
						deviceId: device.id,
						eventType: "connected",
						source: "device",
						deviceTime: parsed.data.timestamp,
					},
				}),
			];

			if (wasOffline && device.lastSeenAt) {
				operations.push(
					prisma.deviceStateEvent.create({
						data: {
							deviceId: device.id,
							eventType: "disconnected",
							source: "system",
							deviceTime: device.lastSeenAt.toISOString(),
							metadata: { durationMs: Date.now() - device.lastSeenAt.getTime() },
						},
					}),
				);
			}

			// Phase 3: auto-clear disconnected notifications on reconnect.
			if (wasOffline && device.pondId) {
				operations.push(
					prisma.notification.updateMany({
						where: {
							pondId: device.pondId,
							category: "connectivity",
							autoCleared: false,
							acknowledgedAt: null,
						},
						data: {
							autoCleared: true,
							read: true,
						},
					}),
				);
			}

			await prisma.$transaction(operations);
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				return new Response(null, { status: 204 });
			}
			throw error;
		}
	} else if (eventType === "feed_dispensed") {
		const parsed = feedDispensedSchema.safeParse(body);
		if (!parsed.success) {
			return new Response("Unprocessable Entity", { status: 422 });
		}

		const isManualSource = parsed.data.source === "dashboard" || parsed.data.source === "button";
		const sourceLabel = { scheduled: "Scheduled", dashboard: "Dashboard", button: "Button" }[
			parsed.data.source
		];

		try {
			const operations: Prisma.PrismaPromise<unknown>[] = [
				prisma.energyDevice.update({
					where: { id: device.id },
					data: { lastSeenAt: new Date() },
				}),
				prisma.feedEvent.create({
					data: {
						deviceId: device.id,
						eventId,
						eventType: "feed_dispensed",
						timestamp: parsed.data.timestamp,
						grams: parsed.data.grams,
						source: parsed.data.source,
						feedRequestId: parsed.data.feed_request_id ?? null,
					},
				}),
				prisma.deviceStateEvent.create({
					data: {
						deviceId: device.id,
						eventType: "feed_dispensed",
						source: "device",
						actorId: parsed.data.source === "dashboard" ? "system" : null,
						deviceTime: parsed.data.timestamp,
						metadata: {
							grams: parsed.data.grams,
							source: parsed.data.source,
							feedRequestId: parsed.data.feed_request_id ?? null,
						},
					},
				}),
			];

			if (parsed.data.feed_request_id) {
				operations.push(
					prisma.feedRequest.updateMany({
						where: {
							id: parsed.data.feed_request_id,
							deviceId: device.id,
							status: "dispatched",
						},
						data: { status: "completed" },
					}),
				);
			} else {
				// Gap 1 reconciliation: late-arriving button/scheduled event without a feed_request_id.
				// Check for orphaned expired/pending FeedRequests within the lookback window.
				const orphanedRequests = await prisma.feedRequest.findMany({
					where: {
						deviceId: device.id,
						status: { in: ["pending", "expired"] },
						createdAt: {
							gte: new Date(Date.now() - RECONCILIATION_LOOKBACK_HOURS * 60 * 60 * 1000),
						},
					},
					orderBy: { createdAt: "desc" },
					take: 5,
				});

				for (const req of orphanedRequests) {
					operations.push(
						prisma.feedRequest.update({
							where: { id: req.id },
							data: { status: "fulfilled_by_other_trigger" },
						}),
					);
					operations.push(
						prisma.deviceStateEvent.create({
							data: {
								deviceId: device.id,
								eventType: "feed_reconciled",
								source: "system",
								deviceTime: parsed.data.timestamp,
								metadata: {
									expiredRequestId: req.id,
									originalGrams: req.grams,
									actualGrams: parsed.data.grams,
									actualSource: parsed.data.source,
								},
							},
						}),
					);
				}
			}

			if (device.pondId && isManualSource) {
				operations.push(
					prisma.notification.create({
						data: {
							pondId: device.pondId,
							tier: "SUCCESS",
							category: "feeding",
							message: `${sourceLabel} feed completed — ${parsed.data.grams}g dispensed by ${device.label}`,
						},
					}),
				);
			}

			await prisma.$transaction(operations);
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				return new Response(null, { status: 204 });
			}
			throw error;
		}
	} else if (eventType === "schedule_acked") {
		const parsed = scheduleAckedSchema.safeParse(body);
		if (!parsed.success) {
			return new Response("Unprocessable Entity", { status: 422 });
		}

		try {
			const scheduleCommand = await prisma.scheduleCommand.findFirst({
				where: { id: parsed.data.command_id, deviceId: device.id },
			});

			if (scheduleCommand) {
				await prisma.$transaction([
					prisma.energyDevice.update({
						where: { id: device.id },
						data: { lastSeenAt: new Date() },
					}),
					prisma.scheduleCommand.update({
						where: { id: scheduleCommand.id },
						data: {
							status: "applied",
							appliedAt: now(),
							deviceTime: parsed.data.timestamp,
						},
					}),
					prisma.feedEvent.create({
						data: {
							deviceId: device.id,
							eventId,
							eventType: "schedule_acked",
							timestamp: parsed.data.timestamp,
							commandId: scheduleCommand.id,
						},
					}),
					prisma.deviceStateEvent.create({
						data: {
							deviceId: device.id,
							eventType: "command_acked",
							source: "device",
							deviceTime: parsed.data.timestamp,
							metadata: {
								commandId: scheduleCommand.id,
								scheduleStart: scheduleCommand.scheduleStart.toISOString(),
								scheduleEnd: scheduleCommand.scheduleEnd.toISOString(),
								feedsPerDay: scheduleCommand.feedsPerDay,
								feedingRatePct: scheduleCommand.feedingRatePct,
							},
						},
					}),
				]);
			}
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				return new Response(null, { status: 204 });
			}
			throw error;
		}
	}

	return new Response(null, { status: 204 });
}
