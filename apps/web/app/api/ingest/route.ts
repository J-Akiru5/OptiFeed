import { withApi } from "@/lib/api/instrumentation";
import {
	FEED_DAYS_WARNING,
	HEARTBEAT_ROW_INTERVAL_MS,
	OFFLINE_THRESHOLD_MS,
	PELLET_ALERT_WINDOW_MS,
	RECONCILIATION_LOOKBACK_HOURS,
} from "@/lib/constants";
import { isDeviceApproved, verifyDeviceToken } from "@/lib/device-auth";
import { normalizeNotificationPrefs } from "@/lib/limits";
import { absoluteAppUrl, sendTelegramMessage } from "@/lib/notify/telegram";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import { recordMissedFeedingAlert } from "@/lib/settings/missed-feeding";
import { ORG_SETTINGS_DEFAULTS, getOrgAlertRoles, getOrgSettingsForFarm } from "@/lib/settings/org";
import { hopperAlertTier, shouldCreatePondAlert } from "@/lib/settings/org-alerts";
import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Devices are considered disconnected if no heartbeat for OFFLINE_THRESHOLD_MS
// (lib/constants.ts) — matches the dashboard's offline threshold.

const RATE_LIMIT_MS = 1000;

// Water temperature history is thinned: a new WaterTempLog row at most once per
// device per 5 minutes, so heartbeats every second do not flood the table the
// dashboard chart reads (I-06b).
const WATER_TEMP_LOG_INTERVAL_MS = 5 * 60 * 1000;

// OTA diagnostics are additive heartbeat fields (firmware 1.4.0+, T-12b). They
// are free-text strings rather than enums so a newer firmware reporting a new
// state is still accepted; the known values are documented in
// firmware/README.md (`ota_state`: idle, checking, deferred, pending_verify,
// valid, downloading, installed, aborted, failed, rolled_back; `reset_reason`:
// poweron, external, software, panic, interrupt_wdt, task_wdt, wdt, deepsleep,
// brownout, sdio, unknown).
const OTA_LIFECYCLE_EVENTS = {
	installed: "ota_installed",
	valid: "ota_valid",
	rolled_back: "ota_rolled_back",
} as const;

const OTA_LIFECYCLE_EVENT_TYPES = Object.values(OTA_LIFECYCLE_EVENTS);

type OtaLifecycleState = keyof typeof OTA_LIFECYCLE_EVENTS;

/** Map the heartbeat's reported OTA state to the audited transition event. */
function otaLifecycleEventType(state: string | undefined): string | null {
	if (!state) return null;
	return state in OTA_LIFECYCLE_EVENTS ? OTA_LIFECYCLE_EVENTS[state as OtaLifecycleState] : null;
}

const baseSchema = z.object({
	device_id: z.string().min(1),
	event_type: z.enum(["heartbeat", "feed_dispensed", "schedule_acked", "feed_refused"]),
	timestamp: z.string().min(1),
	event_id: z.string().min(8).optional(),
	// Present on heartbeats since 1.4.0 and optionally on other events.
	firmware_version: z.string().min(1).max(32).optional(),
});

const heartbeatSchema = baseSchema.extend({
	rtc_ok: z.boolean(),
	feeder_active: z.boolean(),
	// Additive OTA diagnostics — unknown keys were stripped before T-12b, so
	// old servers and new units never disagreed about a heartbeat.
	ota_state: z.string().min(1).max(32).optional(),
	reset_reason: z.string().min(1).max(32).optional(),
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

/**
 * Schedule work after the response (§8.2 rule 9). `after()` throws when called
 * outside a request scope (unit tests, scripts), so fall back to fire-and-forget
 * there; the helper itself already swallows delivery failures.
 */
function runAfterResponse(task: () => Promise<unknown>): void {
	try {
		after(task);
	} catch {
		void task();
	}
}

export const POST = withApi(
	async (request: Request) => {
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

		// Org registration policy: a pending or rejected unit is not allowed to
		// send telemetry or consume commands until an admin approves it.
		if (!isDeviceApproved(device)) {
			return new Response("Forbidden", { status: 403 });
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

			// OTA lifecycle (T-12b): audit a transition, not every beat. The last
			// `ota_*` row is the comparator, so `valid` repeated for days writes
			// once and a rollback after an install writes a new row. A lookup
			// failure must never drop the heartbeat itself; the transition is then
			// recorded on a later beat.
			const otaEventType = otaLifecycleEventType(parsed.data.ota_state);
			let otaTransitionEvent: string | null = null;
			if (otaEventType) {
				try {
					const lastOtaEvent = await prisma.deviceStateEvent.findFirst({
						where: {
							deviceId: device.id,
							eventType: { in: OTA_LIFECYCLE_EVENT_TYPES },
						},
						orderBy: { createdAt: "desc" },
						select: { eventType: true, metadata: true },
					});
					const lastMetadata = (lastOtaEvent?.metadata ?? null) as { version?: unknown } | null;
					const lastVersion =
						typeof lastMetadata?.version === "string" ? lastMetadata.version : null;
					if (
						!lastOtaEvent ||
						lastOtaEvent.eventType !== otaEventType ||
						lastVersion !== (parsed.data.firmware_version ?? null)
					) {
						otaTransitionEvent = otaEventType;
					}
				} catch (error) {
					console.warn(
						"[ingest] OTA state lookup failed",
						error instanceof Error ? error.message : String(error),
					);
				}
			}

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

				// OTA lifecycle transition (ota_installed / ota_valid /
				// ota_rolled_back) with the reported version, so the rollout can be
				// audited from existing DeviceStateEvent rows. No schema change.
				if (otaTransitionEvent) {
					operations.push(
						prisma.deviceStateEvent.create({
							data: {
								deviceId: device.id,
								eventType: otaTransitionEvent,
								source: "device",
								deviceTime: parsed.data.timestamp,
								metadata: {
									state: parsed.data.ota_state,
									...(parsed.data.firmware_version
										? { version: parsed.data.firmware_version }
										: {}),
									...(parsed.data.reset_reason ? { resetReason: parsed.data.reset_reason } : {}),
								},
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

					// Org policy (issue #190): the pond's personal prefs and the
					// owning org's settings decide the warning threshold and whether
					// an alert is created. With no resolvable pond/org the schema
					// defaults and every role apply, matching legacy behaviour.
					const pondContext = device.pondId
						? await prisma.pond.findUnique({
								where: { id: device.pondId },
								select: { feedsPerDay: true, ownerId: true, notificationPrefs: true },
							})
						: null;
					const orgContext = pondContext ? await getOrgSettingsForFarm(pondContext.ownerId) : null;
					const feedSettings = orgContext?.settings ?? ORG_SETTINGS_DEFAULTS;
					const feedPrefs = normalizeNotificationPrefs(pondContext?.notificationPrefs);

					// Resolved lazily: a healthy hopper costs no membership query.
					let alertRoles: Awaited<ReturnType<typeof getOrgAlertRoles>> | null = null;
					const hopperAlertsAllowed = async (): Promise<boolean> => {
						if (!device.pondId) return false;
						alertRoles ??= await getOrgAlertRoles(orgContext?.orgId ?? null);
						return shouldCreatePondAlert({
							settings: feedSettings,
							category: "hopper_low",
							prefs: feedPrefs,
							roles: alertRoles,
						});
					};

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
					const pelletTier = hopperAlertTier(pelletLevel, feedSettings.hopperLowPct);
					const pelletAlertAllowed = pelletTier ? await hopperAlertsAllowed() : false;

					// Resolved whenever the device has a pond, not only when this reading
					// is low: the days-of-feed-remaining branch below needs the same
					// dedup state even when the hopper is back above its threshold.
					let recentPelletAlert: { tier: string; createdAt: Date } | null = null;
					if (device.pondId) {
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
					// An unacknowledged pellet alert still inside the window already
					// tells the farmer the hopper is low. The days-remaining warning is
					// the same category for the same pond, so stacking it on top makes
					// the two messages alternate tier on every heartbeat
					// (CRITICAL → WARNING → CRITICAL …) instead of informing.
					const pelletAlertOutstanding =
						recentPelletAlert !== null &&
						Date.now() - recentPelletAlert.createdAt.getTime() < PELLET_ALERT_WINDOW_MS;

					// Set when this heartbeat already queued a hopper alert, so the
					// days-of-feed-remaining branch below cannot queue a second, weaker
					// one from the same (pre-transaction) reading.
					let pelletAlertQueued = false;

					if (
						pelletTier &&
						device.pondId &&
						pelletAlertAllowed &&
						shouldFirePelletAlert(pelletTier)
					) {
						pelletAlertQueued = true;
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
						if (deviceFull?.hopperCapacityG && deviceFull.gramsPerFeeding && pondContext) {
							const dailyConsumptionG = deviceFull.gramsPerFeeding * pondContext.feedsPerDay;
							const remainingG =
								deviceFull.hopperCapacityG * (parsed.data.feed_level_percent / 100);
							const daysRemaining = dailyConsumptionG > 0 ? remainingG / dailyConsumptionG : 99;
							if (
								daysRemaining <= FEED_DAYS_WARNING &&
								daysRemaining > 0 &&
								!pelletAlertQueued &&
								!pelletAlertOutstanding &&
								(await hopperAlertsAllowed())
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

					// Detect hopper refill: previously low level is now above the org threshold
					if (
						lastLog &&
						lastLog.levelPercent <= feedSettings.hopperLowPct &&
						parsed.data.feed_level_percent > feedSettings.hopperLowPct
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

					// Also keep the history the dashboard chart reads. Throttled to one
					// row per device per 5 minutes; a rejected/absent probe writes nothing.
					const lastTempLog = await prisma.waterTempLog.findFirst({
						where: { deviceId: device.id },
						orderBy: { recordedAt: "desc" },
						select: { recordedAt: true },
					});
					const tempLogDue =
						!lastTempLog ||
						Date.now() - lastTempLog.recordedAt.getTime() >= WATER_TEMP_LOG_INTERVAL_MS;
					if (tempLogDue) {
						// Ownership stamp, same convention as FeedLevelLog.farmId: the
						// device has no farm of its own, so read it from its pond (at most
						// once per 5 minutes, only when the row is due).
						const pondFarm = device.pondId
							? await prisma.pond.findUnique({
									where: { id: device.pondId },
									select: { farmId: true },
								})
							: null;
						operations.push(
							prisma.waterTempLog.create({
								data: {
									deviceId: device.id,
									tempC: parsed.data.water_temp_c,
									farmId: pondFarm?.farmId ?? null,
								},
							}),
						);
					}
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
					const message = `CRITICAL — ${device.label}: feed hopper is nearly empty (${parsed.data.feed_level_percent}%). Refill immediately.${link ? `\n${link}` : ""}`;
					// §8.2 rule 9: the Telegram round-trip is not part of the device's
					// request. Schedule it after the response instead of awaiting it.
					runAfterResponse(() => sendTelegramMessage(message));
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

			// T-12b: an OTA download in progress is a distinct lifecycle refusal,
			// audited under `ota_*` with the version in metadata. No schema change.
			const otaRefusal = parsed.data.reason === "ota_in_progress";

			// 1.4.0's refusal payload has no firmware_version, so fall back to the
			// version on the last OTA lifecycle row. A lookup failure only omits
			// metadata; the refusal itself is still recorded.
			let refusalVersion = parsed.data.firmware_version ?? null;
			if (otaRefusal && !refusalVersion) {
				try {
					const lastOtaEvent = await prisma.deviceStateEvent.findFirst({
						where: {
							deviceId: device.id,
							eventType: { in: OTA_LIFECYCLE_EVENT_TYPES },
						},
						orderBy: { createdAt: "desc" },
						select: { metadata: true },
					});
					const metadata = (lastOtaEvent?.metadata ?? null) as { version?: unknown } | null;
					if (typeof metadata?.version === "string") refusalVersion = metadata.version;
				} catch (error) {
					console.warn(
						"[ingest] OTA version lookup failed",
						error instanceof Error ? error.message : String(error),
					);
				}
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
							eventType: otaRefusal ? "ota_feed_refused" : "feed_refused",
							source: "device",
							deviceTime: parsed.data.timestamp,
							metadata: {
								grams: parsed.data.grams,
								source: parsed.data.source,
								reason: parsed.data.reason,
								...(refusalVersion ? { version: refusalVersion } : {}),
							},
						},
					}),
				]);

				// A scheduled dose the firmware refused is a missed feeding. The
				// org's missed-feeding policy, the pond's prefs and the alert roles
				// decide whether anything is sent (issue #190); ReminderLog dedupes it
				// to one per device per day. Never fail the device response over it.
				if (parsed.data.source === "scheduled") {
					try {
						await recordMissedFeedingAlert({
							deviceId: device.id,
							deviceLabel: device.label,
							pondId: device.pondId,
							grams: parsed.data.grams,
							reason: parsed.data.reason,
							timestamp: parsed.data.timestamp,
						});
					} catch (alertError) {
						console.warn(
							"[ingest] missed-feeding alert failed",
							alertError instanceof Error ? alertError.message : String(alertError),
						);
					}
				}
			} catch (error) {
				if (isUniqueConstraintError(error)) {
					return new Response(null, { status: 204 });
				}
				reportError(error, { route: "ingest", deviceId: device.id });
				throw error;
			}
		}

		return new Response(null, { status: 204 });
	},
	// Device (ESP32) contract: status-only responses are external and exempt
	// from the §4 envelope. Heartbeats batch several writes; the guard stays
	// above the measured p95 but below the platform limit.
	{ route: "POST /api/ingest", shape: "passthrough", cacheControl: "no-store", timeoutMs: 5_000 },
);
