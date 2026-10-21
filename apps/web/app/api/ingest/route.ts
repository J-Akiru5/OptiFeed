import {
	FEED_DAYS_WARNING,
	HEARTBEAT_ROW_INTERVAL_MS,
	OFFLINE_THRESHOLD_MS,
	PELLET_ALERT_WINDOW_MS,
	PELLET_CRITICAL_PCT,
	PELLET_LOW_PCT,
	RECONCILIATION_LOOKBACK_HOURS,
} from "@/lib/constants";
import { verifyDeviceToken } from "@/lib/device-auth";
import { absoluteAppUrl, sendTelegramMessage } from "@/lib/notify/telegram";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Devices are considered disconnected if no heartbeat for OFFLINE_THRESHOLD_MS
// (lib/constants.ts) — matches the dashboard's offline threshold.

const RATE_LIMIT_MS = 1000;

const baseSchema = z.object({
	device_id: z.string().min(1),
	event_type: z.enum(["heartbeat", "feed_dispensed", "schedule_acked", "feed_refused"]),
	timestamp: z.string().min(1),
	event_id: z.string().min(8).optional(),
});

const heartbeatSchema = baseSchema.extend({
	rtc_ok: z.boolean(),
	feeder_active: z.boolean(),
	// Feed level monitoring — piggybacked on existing heartbeat
	feed_level_percent: z.number().min(0).max(100).optional(),
	feed_level_cm: z.number().min(0).optional(),
	// Water temperature (DS18B20 probe) — piggybacked on existing heartbeat
	water_temp_c: z.number().optional(),
	water_temp_ok: z.boolean().optional(),
});

const feedDispensedSchema = baseSchema.extend({
	grams: z.number().positive(),
	source: z.enum(["scheduled", "dashboard", "button"]),
	feed_request_id: z.string().nullable().optional(),
});

const scheduleAckedSchema = baseSchema.extend({
	command_id: z.string().min(1),
});

const feedRefusedSchema = baseSchema.extend({
	grams: z.number().positive(),
	source: z.enum(["scheduled", "dashboard", "button"]),
	reason: z.string().min(1),
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

	const device = await verifyDeviceToken(token);
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

		// Thinning (N11): look up the last heartbeat row so we only write a new
		// one when 5 minutes have passed or a stored value changed.
		const lastHeartbeat = await prisma.feedEvent.findFirst({
			where: { deviceId: device.id, eventType: "heartbeat" },
			orderBy: { receivedAt: "desc" },
			select: { receivedAt: true, rtcOk: true, feederActive: true },
		});
		const heartbeatChanged =
			!lastHeartbeat ||
			lastHeartbeat.rtcOk !== parsed.data.rtc_ok ||
			lastHeartbeat.feederActive !== parsed.data.feeder_active;
		const heartbeatDue =
			!lastHeartbeat ||
			Date.now() - lastHeartbeat.receivedAt.getTime() >= HEARTBEAT_ROW_INTERVAL_MS;

		// Set when this request queues a CRITICAL pellet notification, so the
		// Telegram fan-out (3.5) runs once, after the transaction commits.
		let pelletCriticalAlert = false;

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
			];

			if (heartbeatChanged || heartbeatDue) {
				operations.push(
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
				);
			}

			// N15: "connected" only on first contact or offline→online, not every beat.
			if (wasOffline) {
				operations.push(
					prisma.deviceStateEvent.create({
						data: {
							deviceId: device.id,
							eventType: "connected",
							source: "device",
							deviceTime: parsed.data.timestamp,
						},
					}),
				);
			}

			// Feed level sensor reading piggybacked on heartbeat
			if (typeof parsed.data.feed_level_percent === "number") {
				operations.push(
					prisma.energyDevice.update({
						where: { id: device.id },
						data: {
							feedLevelPercent: parsed.data.feed_level_percent,
							feedLevelCm: parsed.data.feed_level_cm ?? null,
							feedLevelUpdatedAt: new Date(),
						},
					}),
				);

				// Log to FeedLevelLog sparingly — every 30min or >5% delta
				const lastLog = await prisma.feedLevelLog.findFirst({
					where: { deviceId: device.id },
					orderBy: { recordedAt: "desc" },
				});
				const shouldLog =
					!lastLog ||
					Date.now() - lastLog.recordedAt.getTime() > 30 * 60 * 1000 ||
					Math.abs(lastLog.levelPercent - parsed.data.feed_level_percent) > 5;
				if (shouldLog) {
					operations.push(
						prisma.feedLevelLog.create({
							data: {
								deviceId: device.id,
								levelPercent: parsed.data.feed_level_percent,
								distanceCm: parsed.data.feed_level_cm ?? 0,
							},
						}),
					);
				}

				// Pellet alert dedup (N11): fire only on a tier transition or at most
				// once per 6h while still low. Gate uses the most recent
				// unacknowledged pellet notification for this pond (if any).
				const pelletLevel = parsed.data.feed_level_percent;
				let pelletTier: "WARNING" | "CRITICAL" | null = null;
				if (pelletLevel <= PELLET_CRITICAL_PCT) pelletTier = "CRITICAL";
				else if (pelletLevel <= PELLET_LOW_PCT) pelletTier = "WARNING";

				let recentPelletAlert: { tier: string; createdAt: Date } | null = null;
				if (pelletTier && device.pondId) {
					recentPelletAlert = await prisma.notification.findFirst({
						where: { pondId: device.pondId, category: "pellet", acknowledgedAt: null },
						orderBy: { createdAt: "desc" },
						select: { tier: true, createdAt: true },
					});
				}
				const shouldFirePelletAlert = (tier: "WARNING" | "CRITICAL"): boolean => {
					if (!device.pondId) return false;
					if (!recentPelletAlert) return true;
					const withinWindow =
						Date.now() - recentPelletAlert.createdAt.getTime() < PELLET_ALERT_WINDOW_MS;
					return recentPelletAlert.tier !== tier || !withinWindow;
				};

				if (pelletTier && device.pondId && shouldFirePelletAlert(pelletTier)) {
					if (pelletTier === "CRITICAL") {
						pelletCriticalAlert = true;
						operations.push(
							prisma.notification.create({
								data: {
									pondId: device.pondId,
									tier: "CRITICAL",
									category: "pellet",
									message: "Feed hopper is nearly empty — refill immediately",
									linkTo: "/dashboard/settings",
								},
							}),
							prisma.deviceStateEvent.create({
								data: {
									deviceId: device.id,
									eventType: "pellet_low",
									source: "device",
									deviceTime: parsed.data.timestamp,
									metadata: { levelPercent: parsed.data.feed_level_percent },
								},
							}),
						);
					} else {
						operations.push(
							prisma.notification.create({
								data: {
									pondId: device.pondId,
									tier: "WARNING",
									category: "pellet",
									message: "Feed hopper is running low — schedule a refill soon",
									linkTo: "/dashboard/settings",
								},
							}),
						);
					}
				}

				// 2-days-of-feed-remaining advance warning
				if (device.pondId) {
					const deviceFull = await prisma.energyDevice.findUnique({
						where: { id: device.id },
						select: { hopperCapacityG: true, gramsPerFeeding: true },
					});
					const pond = await prisma.pond.findUnique({
						where: { id: device.pondId },
						select: { feedsPerDay: true },
					});
					if (deviceFull?.hopperCapacityG && deviceFull.gramsPerFeeding && pond) {
						const dailyConsumptionG = deviceFull.gramsPerFeeding * pond.feedsPerDay;
						const remainingG = deviceFull.hopperCapacityG * (parsed.data.feed_level_percent / 100);
						const daysRemaining = dailyConsumptionG > 0 ? remainingG / dailyConsumptionG : 99;
						if (
							daysRemaining <= FEED_DAYS_WARNING &&
							daysRemaining > 0 &&
							shouldFirePelletAlert("WARNING")
						) {
							operations.push(
								prisma.notification.create({
									data: {
										pondId: device.pondId,
										tier: "WARNING",
										category: "pellet",
										message: `Feed will run out in ~${Math.ceil(daysRemaining)} day(s) — refill hopper soon`,
										linkTo: "/dashboard/settings",
									},
								}),
							);
						}
					}
				}

				// Detect hopper refill: previously low level is now above threshold
				if (
					lastLog &&
					lastLog.levelPercent <= PELLET_LOW_PCT &&
					parsed.data.feed_level_percent > PELLET_LOW_PCT
				) {
					operations.push(
						prisma.deviceStateEvent.create({
							data: {
								deviceId: device.id,
								eventType: "pellet_refilled",
								source: "device",
								deviceTime: parsed.data.timestamp,
								metadata: {
									previousLevel: lastLog.levelPercent,
									currentLevel: parsed.data.feed_level_percent,
								},
							},
						}),
					);
				}
			}

			// Water temperature sensor reading piggybacked on heartbeat
			if (typeof parsed.data.water_temp_c === "number" && parsed.data.water_temp_ok === true) {
				operations.push(
					prisma.energyDevice.update({
						where: { id: device.id },
						data: {
							waterTempC: parsed.data.water_temp_c,
							waterTempOk: true,
							waterTempUpdatedAt: new Date(),
						},
					}),
				);
			} else {
				// Probe undetected (or field omitted) — flag offline without overwriting
				// the last real reading with the -127 disconnect sentinel.
				operations.push(
					prisma.energyDevice.update({
						where: { id: device.id },
						data: { waterTempOk: false },
					}),
				);
			}

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

			// 3.5: Telegram fan-out only after the row exists (one message per
			// alert — repeats are already suppressed by the dedup gate above).
			if (pelletCriticalAlert) {
				const link = absoluteAppUrl("/dashboard/settings");
				await sendTelegramMessage(
					`CRITICAL — ${device.label}: feed hopper is nearly empty (${parsed.data.feed_level_percent}%). Refill immediately.${link ? `\n${link}` : ""}`,
				);
			}
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				return new Response(null, { status: 204 });
			}
			reportError(error, { route: "ingest", deviceId: device.id });
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

		// Gap #2: a retry of the same feed (same requestId + source) must not
		// double-count, even when the firmware regenerated its event_id.
		if (parsed.data.feed_request_id) {
			const existing = await prisma.feedEvent.findFirst({
				where: {
					feedRequestId: parsed.data.feed_request_id,
					source: parsed.data.source,
					eventType: "feed_dispensed",
				},
				select: { id: true },
			});
			if (existing) {
				return new Response(null, { status: 204 });
			}
		}

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
			reportError(error, { route: "ingest", deviceId: device.id });
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

			if (scheduleCommand && device.pondId) {
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
					prisma.deviceStateEvent.create({
						data: {
							deviceId: device.id,
							eventType: "schedule_applied",
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
					prisma.pond.update({
						where: { id: device.pondId },
						data: {
							feedingRatePct: scheduleCommand.feedingRatePct,
							feedsPerDay: scheduleCommand.feedsPerDay,
							scheduleStart: scheduleCommand.scheduleStart,
							scheduleEnd: scheduleCommand.scheduleEnd,
						},
					}),
				]);
			}
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				return new Response(null, { status: 204 });
			}
			reportError(error, { route: "ingest", deviceId: device.id });
			throw error;
		}
	} else if (eventType === "feed_refused") {
		// Firmware safety caps refused a dose (over per-dose grams, dose time,
		// or the daily budget) — audit-only; no FeedEvent is created.
		const parsed = feedRefusedSchema.safeParse(body);
		if (!parsed.success) {
			return new Response("Unprocessable Entity", { status: 422 });
		}

		try {
			await prisma.$transaction([
				prisma.energyDevice.update({
					where: { id: device.id },
					data: { lastSeenAt: new Date() },
				}),
				prisma.deviceStateEvent.create({
					data: {
						deviceId: device.id,
						eventType: "feed_refused",
						source: "device",
						deviceTime: parsed.data.timestamp,
						metadata: {
							grams: parsed.data.grams,
							source: parsed.data.source,
							reason: parsed.data.reason,
						},
					},
				}),
			]);
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				return new Response(null, { status: 204 });
			}
			reportError(error, { route: "ingest", deviceId: device.id });
			throw error;
		}
	}

	return new Response(null, { status: 204 });
}
