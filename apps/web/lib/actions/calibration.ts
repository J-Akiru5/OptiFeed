"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentPondOwnerId, getCurrentUser, requireWriteAccess } from "@/lib/auth/session";
import { isValidRecalibrationIntervalDays } from "@/lib/calibration/recalibration";
import { isValidCalibrationSessionId } from "@/lib/calibration/session";
import { STALE_DISPATCHED_MS } from "@/lib/constants";
import {
	CALIBRATION_ACTUAL_GRAMS_MAX,
	CALIBRATION_TEST_GRAMS_MAX,
	CALIBRATION_TEST_SECONDS_MAX,
	CALIBRATION_TEST_SECONDS_MIN,
	GRAMS_PER_SECOND_MAX,
	GRAMS_PER_SECOND_MIN,
	OFFLINE_THRESHOLD_MS,
	TARGET_CHECK_GRAMS_MAX,
	TARGET_CHECK_GRAMS_MIN,
	TARGET_CHECK_TOLERANCE_PCT,
	resolveDailyCapG,
} from "@/lib/limits";
import prisma from "@/lib/prisma";
import { getFeedingLimits } from "@/lib/settings/feeding-caps";
import { revalidatePath } from "next/cache";

export interface CalibrationTestResult {
	success: boolean;
	error?: string;
	requestId?: string;
	testGrams?: number;
	expectedSeconds?: number;
}

export interface CalibrationStatusResult {
	success: boolean;
	error?: string;
	status?: "pending" | "dispatched" | "completed" | "expired" | "missing";
}

export interface CalibrationSaveResult {
	success: boolean;
	error?: string;
	previousGramsPerSecond?: number;
	newGramsPerSecond?: number;
	gramsPerFeeding?: number;
	previousDurationSeconds?: number;
	newDurationSeconds?: number;
	/** 1-based attempt within the calibration session. */
	attempt?: number;
	/** Attempts before this one in the same session. */
	reTests?: number;
}

export interface TargetCheckResult {
	success: boolean;
	error?: string;
	requestId?: string;
	targetGrams?: number;
	expectedSeconds?: number;
	durationMs?: number;
}

export interface TargetCheckSubmitResult {
	success: boolean;
	error?: string;
	attempt?: number;
	reTests?: number;
	errorPct?: number;
	correctedGramsPerSecond?: number;
	accepted?: boolean;
	/** True when the corrected rate (and lastCalibratedAt) was persisted. */
	saved?: boolean;
	previousGramsPerSecond?: number;
	gramsPerFeeding?: number;
	previousDurationSeconds?: number;
	newDurationSeconds?: number;
}

export type TargetCheckDecision = "retest" | "save" | "save_anyway";

const TEST_SECONDS_ERROR = `Test duration must be a whole number between ${CALIBRATION_TEST_SECONDS_MIN} and ${CALIBRATION_TEST_SECONDS_MAX} seconds`;

const TEST_DOSE_RANGE_ERROR = `Test dose would dispense outside the supported 1–${CALIBRATION_TEST_GRAMS_MAX} g range. Shorten the test duration.`;

// Issue #191: a target check dispenses an exact dose and corrects the rate from
// the weighing error. Bounds and tolerance live in lib/limits.ts with the other
// calibration limits.

const TARGET_GRAMS_ERROR = `Target dose must be between ${TARGET_CHECK_GRAMS_MIN} and ${TARGET_CHECK_GRAMS_MAX} g`;

// One session per calibration sitting. The client sends a crypto.randomUUID()
// token; lib/calibration/session.ts validates its shape.
const SESSION_ID_ERROR = "Calibration session id is invalid — reload the page and try again.";

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * Start and end of the current Asia/Manila calendar day, as UTC instants.
 * Mirrors the daily cap window used by requestFeed in lib/actions/energy.ts.
 */
function manilaDayRange(nowMs = Date.now()): { start: Date; end: Date } {
	const HOUR_MS = 60 * 60 * 1000;
	const DAY_MS = 24 * HOUR_MS;
	const startOfLocalDay = Math.floor((nowMs + 8 * HOUR_MS) / DAY_MS) * DAY_MS - 8 * HOUR_MS;
	return { start: new Date(startOfLocalDay), end: new Date(startOfLocalDay + DAY_MS) };
}

function isValidTestSeconds(testSeconds: number): boolean {
	return (
		Number.isInteger(testSeconds) &&
		testSeconds >= CALIBRATION_TEST_SECONDS_MIN &&
		testSeconds <= CALIBRATION_TEST_SECONDS_MAX
	);
}

function revalidateCalibrationPaths(): void {
	// The hardware page reads gramsPerSecond, the schedule page previews feed
	// duration, and the dashboard shows the derived per-feeding duration.
	revalidatePath("/[locale]/(dashboard)/dashboard/settings/hardware", "page");
	revalidatePath("/[locale]/(dashboard)/dashboard/schedule", "page");
	revalidatePath("/[locale]/(dashboard)/dashboard", "page");
}

function isValidTargetGrams(value: number): boolean {
	return (
		Number.isFinite(value) && value >= TARGET_CHECK_GRAMS_MIN && value <= TARGET_CHECK_GRAMS_MAX
	);
}

/**
 * Attempt numbers are computed on the server from the runs already recorded for
 * the session, so a client cannot claim a lower re-test count.
 */
async function nextAttempt(
	deviceId: string,
	sessionId: string,
	kind: "RATE_TEST" | "TARGET_CHECK",
): Promise<{ attempt: number; reTests: number }> {
	const previous = await prisma.calibrationRun.count({
		where: { deviceId, sessionId, kind },
	});
	const attempt = previous + 1;
	return { attempt, reTests: attempt - 1 };
}

async function currentActorId(): Promise<string | null> {
	const user = await getCurrentUser();
	return user?.id ?? null;
}

/**
 * The single queue write used by both calibration kinds. It is an ordinary
 * FeedRequest, so the device poll/dispatch, ingest confirmation, rate limiting
 * and MAX_DISPENSE_MS enforcement on the device path are unchanged.
 */
async function queueCalibrationDose(input: {
	deviceId: string;
	ownerId: string;
	grams: number;
	eventType: string;
	metadata: Record<string, unknown>;
}): Promise<string> {
	const request = await prisma.feedRequest.create({
		data: {
			deviceId: input.deviceId,
			grams: input.grams,
			status: "pending",
		},
	});

	await prisma.deviceStateEvent.create({
		data: {
			deviceId: input.deviceId,
			eventType: input.eventType,
			source: "user",
			actorId: input.ownerId,
			metadata: { requestId: request.id, ...input.metadata },
		},
	});

	revalidateCalibrationPaths();
	return request.id;
}

/**
 * Queue a fixed-duration test dose for guided motor calibration.
 *
 * The dose is an ordinary FeedRequest so the existing device poll/dispatch and
 * ingest confirmation paths work unchanged; the accompanying DeviceStateEvent
 * records that the request was queued for calibration rather than feeding.
 */
export async function runCalibrationTest(
	deviceId: string,
	testSeconds: number,
	sessionId: string,
): Promise<CalibrationTestResult> {
	// Guard outside try: the catch below returns a generic message and would
	// hide the write-access/permission reason from the caller.
	await requireWriteAccess();
	await requirePermission("manage_schedule");
	await requirePermission("control_feeder");

	try {
		if (!isValidCalibrationSessionId(sessionId)) {
			return { success: false, error: SESSION_ID_ERROR };
		}

		if (!isValidTestSeconds(testSeconds)) {
			return { success: false, error: TEST_SECONDS_ERROR };
		}

		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: {
				gramsPerFeeding: true,
				gramsPerSecond: true,
				lastSeenAt: true,
				hopperCapacityG: true,
				dailyCapG: true,
				pond: { select: { isFallow: true } },
			},
		});

		if (!device) {
			return { success: false, error: "Device not found" };
		}

		if (device.pond?.isFallow) {
			return {
				success: false,
				error: "This pond is fallow after harvest. Start the next grow-out cycle before feeding.",
			};
		}

		// Mirror requestFeed: a dispatched request the device picked up but never
		// confirmed must not block a fresh test dose forever.
		await prisma.feedRequest.updateMany({
			where: {
				deviceId,
				status: "dispatched",
				updatedAt: { lt: new Date(Date.now() - STALE_DISPATCHED_MS) },
			},
			data: { status: "expired" },
		});

		if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS) {
			return {
				success: false,
				error: "Device is offline — calibration test rejected. Retry once the device reconnects.",
			};
		}

		const inFlight = await prisma.feedRequest.findFirst({
			where: { deviceId, status: { in: ["pending", "dispatched"] } },
			select: { status: true },
		});

		if (inFlight) {
			return {
				success: false,
				error:
					"A feed or calibration test is already in progress — wait for it to finish before starting a test dose.",
			};
		}

		const testGrams = round1(device.gramsPerSecond * testSeconds);
		if (!Number.isFinite(testGrams) || testGrams < 1 || testGrams > CALIBRATION_TEST_GRAMS_MAX) {
			return { success: false, error: TEST_DOSE_RANGE_ERROR };
		}

		// The platform cap may shorten the allowed relay run; the test window is
		// user-chosen, so refuse a window that no longer fits instead of quietly
		// queueing a dose the server caps would reject elsewhere.
		const limits = await getFeedingLimits();
		if (testSeconds * 1000 > limits.maxDispenseMs) {
			return {
				success: false,
				error: `The test dose would run longer than the ${limits.maxDispenseMs / 1000} s relay limit. Choose a shorter test.`,
			};
		}

		const day = manilaDayRange();
		const today = await prisma.feedRequest.aggregate({
			where: {
				deviceId,
				status: { in: ["pending", "dispatched", "completed"] },
				createdAt: { gte: day.start, lt: day.end },
			},
			_sum: { grams: true },
		});
		const usedTodayG = today._sum.grams ?? 0;
		const dailyCapG = resolveDailyCapG({
			configuredCapG: device.dailyCapG,
			hopperCapacityG: device.hopperCapacityG,
			dailyCapFactor: limits.dailyCapFactor,
		});
		if (usedTodayG + testGrams > dailyCapG) {
			return {
				success: false,
				error: `Daily feed limit reached — ${Math.round(dailyCapG)} g/day cap with ${Math.round(usedTodayG)} g already used today. Try again after midnight (Asia/Manila).`,
			};
		}

		const requestId = await queueCalibrationDose({
			deviceId,
			ownerId,
			grams: testGrams,
			eventType: "calibration_test_queued",
			metadata: {
				testSeconds,
				testGrams,
				gramsPerSecond: device.gramsPerSecond,
				method: "test_dose",
			},
		});

		return {
			success: true,
			requestId,
			testGrams,
			expectedSeconds: round1(testGrams / device.gramsPerSecond),
		};
	} catch (error) {
		console.error("Failed to queue calibration test:", error);
		return { success: false, error: "Failed to create calibration test" };
	}
}

/**
 * Queue a target-check dose: dispense an exact target weight, then compare the
 * weighed output with the target and correct grams per second from the error.
 *
 * This is the same dispense path as the test dose (an ordinary FeedRequest),
 * with the same daily cap and in-flight/offline guards. MAX_DISPENSE_MS is
 * checked here because the dose is derived from the entered target rather than
 * a bounded test duration.
 */
export async function runTargetCheck(
	deviceId: string,
	targetGrams: number,
	sessionId: string,
): Promise<TargetCheckResult> {
	await requireWriteAccess();
	await requirePermission("manage_schedule");
	await requirePermission("control_feeder");

	try {
		if (!isValidCalibrationSessionId(sessionId)) {
			return { success: false, error: SESSION_ID_ERROR };
		}

		if (!isValidTargetGrams(targetGrams)) {
			return { success: false, error: TARGET_GRAMS_ERROR };
		}

		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: {
				gramsPerSecond: true,
				lastSeenAt: true,
				hopperCapacityG: true,
				dailyCapG: true,
				pond: { select: { isFallow: true } },
			},
		});

		if (!device) {
			return { success: false, error: "Device not found" };
		}

		if (device.pond?.isFallow) {
			return {
				success: false,
				error: "This pond is fallow after harvest. Start the next grow-out cycle before feeding.",
			};
		}

		await prisma.feedRequest.updateMany({
			where: {
				deviceId,
				status: "dispatched",
				updatedAt: { lt: new Date(Date.now() - STALE_DISPATCHED_MS) },
			},
			data: { status: "expired" },
		});

		if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS) {
			return {
				success: false,
				error: "Device is offline — target check rejected. Retry once the device reconnects.",
			};
		}

		if (!(device.gramsPerSecond > 0)) {
			return {
				success: false,
				error: "The device feed rate is invalid. Run a rate test or set the rate manually first.",
			};
		}

		const inFlight = await prisma.feedRequest.findFirst({
			where: { deviceId, status: { in: ["pending", "dispatched"] } },
			select: { status: true },
		});

		if (inFlight) {
			return {
				success: false,
				error:
					"A feed or calibration test is already in progress — wait for it to finish before starting a target check.",
			};
		}

		const checkGrams = round1(targetGrams);
		const limits = await getFeedingLimits();
		const durationMs = Math.round((checkGrams / device.gramsPerSecond) * 1000);
		if (durationMs > limits.maxDispenseMs) {
			return {
				success: false,
				error: `That target needs more than ${limits.maxDispenseMs / 1000} s of relay time at ${device.gramsPerSecond} g/s. Enter a smaller target.`,
			};
		}

		const day = manilaDayRange();
		const today = await prisma.feedRequest.aggregate({
			where: {
				deviceId,
				status: { in: ["pending", "dispatched", "completed"] },
				createdAt: { gte: day.start, lt: day.end },
			},
			_sum: { grams: true },
		});
		const usedTodayG = today._sum.grams ?? 0;
		const dailyCapG = resolveDailyCapG({
			configuredCapG: device.dailyCapG,
			hopperCapacityG: device.hopperCapacityG,
			dailyCapFactor: limits.dailyCapFactor,
		});
		if (usedTodayG + checkGrams > dailyCapG) {
			return {
				success: false,
				error: `Daily feed limit reached — ${Math.round(dailyCapG)} g/day cap with ${Math.round(usedTodayG)} g already used today. Try again after midnight (Asia/Manila).`,
			};
		}

		const requestId = await queueCalibrationDose({
			deviceId,
			ownerId,
			grams: checkGrams,
			eventType: "calibration_target_check_queued",
			metadata: {
				targetGrams: checkGrams,
				gramsPerSecond: device.gramsPerSecond,
				durationMs,
				method: "target_check",
			},
		});

		return {
			success: true,
			requestId,
			targetGrams: checkGrams,
			expectedSeconds: round1(checkGrams / device.gramsPerSecond),
			durationMs,
		};
	} catch (error) {
		console.error("Failed to queue calibration target check:", error);
		return { success: false, error: "Failed to create calibration target check" };
	}
}

/**
 * Read a test dose's dispatch state. Scoped by device and pond owner, so a
 * request belonging to another farm is reported as missing rather than leaked.
 */
export async function getCalibrationTestStatus(
	deviceId: string,
	requestId: string,
): Promise<CalibrationStatusResult> {
	await requireWriteAccess();

	try {
		const ownerId = await getCurrentPondOwnerId();
		const request = await prisma.feedRequest.findFirst({
			where: {
				id: requestId,
				deviceId,
				device: { pond: { ownerId } },
			},
			select: { status: true },
		});

		if (!request) {
			return { success: true, status: "missing" };
		}

		if (request.status === "fulfilled_by_other_trigger") {
			return { success: true, status: "expired" };
		}

		if (
			request.status === "pending" ||
			request.status === "dispatched" ||
			request.status === "completed" ||
			request.status === "expired"
		) {
			return { success: true, status: request.status };
		}

		// Anything else is a legacy/unknown terminal state — never in flight.
		return { success: true, status: "expired" };
	} catch (error) {
		console.error("Failed to read calibration test status:", error);
		return { success: false, error: "Failed to check calibration test status" };
	}
}

/**
 * Save a motor rate measured from a completed test dose, and report the
 * before/after feed duration for the device's configured grams per feeding.
 *
 * The attempt is appended to `CalibrationRun` history and `lastCalibratedAt`
 * resets the recalibration clock.
 */
export async function saveCalibrationFromTest(
	deviceId: string,
	requestId: string,
	testSeconds: number,
	actualGrams: number,
	sessionId: string,
): Promise<CalibrationSaveResult> {
	await requireWriteAccess();
	await requirePermission("manage_schedule");

	try {
		if (!isValidCalibrationSessionId(sessionId)) {
			return { success: false, error: SESSION_ID_ERROR };
		}

		if (!isValidTestSeconds(testSeconds)) {
			return { success: false, error: TEST_SECONDS_ERROR };
		}

		if (
			!Number.isFinite(actualGrams) ||
			actualGrams <= 0 ||
			actualGrams > CALIBRATION_ACTUAL_GRAMS_MAX
		) {
			return {
				success: false,
				error: `Weighed output must be greater than 0 g and at most ${CALIBRATION_ACTUAL_GRAMS_MAX} g`,
			};
		}

		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: { gramsPerFeeding: true, gramsPerSecond: true },
		});

		if (!device) {
			return { success: false, error: "Device not found" };
		}

		const testRequest = await prisma.feedRequest.findFirst({
			where: {
				id: requestId,
				deviceId,
				device: { pond: { ownerId } },
			},
			select: { status: true },
		});

		if (!testRequest) {
			return { success: false, error: "Test dose not found" };
		}

		if (testRequest.status !== "completed") {
			return {
				success: false,
				error:
					"Test dose not confirmed yet — wait for the device to confirm the dispensed weight before saving.",
			};
		}

		const newGramsPerSecond = round2(actualGrams / testSeconds);
		if (newGramsPerSecond < GRAMS_PER_SECOND_MIN || newGramsPerSecond > GRAMS_PER_SECOND_MAX) {
			return {
				success: false,
				error: `Measured rate ${newGramsPerSecond} g/s is outside the supported ${GRAMS_PER_SECOND_MIN}–${GRAMS_PER_SECOND_MAX} g/s range. Check the weighed output and test duration.`,
			};
		}

		const previousGramsPerSecond = device.gramsPerSecond;
		const gramsPerFeeding = device.gramsPerFeeding;
		const previousDurationSeconds =
			previousGramsPerSecond > 0 ? round1(gramsPerFeeding / previousGramsPerSecond) : 0;
		const newDurationSeconds = round1(gramsPerFeeding / newGramsPerSecond);

		const expectedGrams = previousGramsPerSecond > 0 ? previousGramsPerSecond * testSeconds : 0;
		const errorPct =
			expectedGrams > 0 ? round2(((actualGrams - expectedGrams) / expectedGrams) * 100) : null;

		const { attempt, reTests } = await nextAttempt(deviceId, sessionId, "RATE_TEST");
		const createdById = await currentActorId();
		const calibratedAt = new Date();

		await prisma.energyDevice.update({
			where: { id: deviceId },
			data: { gramsPerSecond: newGramsPerSecond, lastCalibratedAt: calibratedAt },
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "duration_calibrated",
				source: "user",
				actorId: ownerId,
				metadata: {
					oldGps: previousGramsPerSecond,
					newGps: newGramsPerSecond,
					testSeconds,
					actualGrams,
					method: "test_dose",
					requestId,
				},
			},
		});

		await prisma.calibrationRun.create({
			data: {
				deviceId,
				sessionId,
				attempt,
				kind: "RATE_TEST",
				durationMs: testSeconds * 1000,
				measuredGrams: actualGrams,
				gramsPerSecondBefore: previousGramsPerSecond,
				gramsPerSecondAfter: newGramsPerSecond,
				errorPct,
				accepted: true,
				createdById,
			},
		});

		revalidateCalibrationPaths();

		return {
			success: true,
			previousGramsPerSecond,
			newGramsPerSecond,
			gramsPerFeeding,
			previousDurationSeconds,
			newDurationSeconds,
			attempt,
			reTests,
		};
	} catch (error) {
		console.error("Failed to save calibration from test dose:", error);
		return { success: false, error: "Failed to save calibration" };
	}
}

const TARGET_DECISIONS: ReadonlySet<TargetCheckDecision> = new Set([
	"retest",
	"save",
	"save_anyway",
]);

/**
 * Record the weighing of a completed target check and act on the operator's
 * decision:
 *
 * - `retest` applies the corrected rate so the next target check dispenses the
 *   right amount, but leaves `lastCalibratedAt` alone (not yet accepted);
 * - `save` / `save_anyway` persist the corrected rate and reset the
 *   recalibration clock.
 *
 * Every decision appends a `CalibrationRun`, so the re-test count is visible in
 * history even when the operator abandons the sitting.
 */
export async function submitTargetCheck(
	deviceId: string,
	requestId: string,
	targetGrams: number,
	measuredGrams: number,
	sessionId: string,
	decision: TargetCheckDecision,
): Promise<TargetCheckSubmitResult> {
	await requireWriteAccess();
	await requirePermission("manage_schedule");
	await requirePermission("control_feeder");

	try {
		if (!isValidCalibrationSessionId(sessionId)) {
			return { success: false, error: SESSION_ID_ERROR };
		}

		if (!isValidTargetGrams(targetGrams)) {
			return { success: false, error: TARGET_GRAMS_ERROR };
		}

		if (!TARGET_DECISIONS.has(decision)) {
			return { success: false, error: "Unknown calibration decision" };
		}

		if (
			!Number.isFinite(measuredGrams) ||
			measuredGrams <= 0 ||
			measuredGrams > CALIBRATION_ACTUAL_GRAMS_MAX
		) {
			return {
				success: false,
				error: `Weighed output must be greater than 0 g and at most ${CALIBRATION_ACTUAL_GRAMS_MAX} g`,
			};
		}

		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: { gramsPerFeeding: true, gramsPerSecond: true },
		});

		if (!device) {
			return { success: false, error: "Device not found" };
		}

		const checkRequest = await prisma.feedRequest.findFirst({
			where: {
				id: requestId,
				deviceId,
				device: { pond: { ownerId } },
			},
			select: { status: true },
		});

		if (!checkRequest) {
			return { success: false, error: "Target check not found" };
		}

		if (checkRequest.status !== "completed") {
			return {
				success: false,
				error:
					"Target check not confirmed yet — wait for the device to confirm the dispensed weight before saving.",
			};
		}

		// One confirmed dose gives exactly one correction: a double submit (or a
		// replayed request) must not compound the g/s change.
		const alreadySubmitted = await prisma.deviceStateEvent.findFirst({
			where: {
				deviceId,
				eventType: "duration_calibrated",
				metadata: { path: ["requestId"], equals: requestId },
			},
			select: { id: true },
		});
		if (alreadySubmitted) {
			return {
				success: false,
				error: "This target check was already submitted. Run a new target check to re-test.",
			};
		}

		const target = round1(targetGrams);
		const beforeGps = device.gramsPerSecond;
		if (!(beforeGps > 0)) {
			return {
				success: false,
				error: "The device feed rate is invalid. Run a rate test or set the rate manually first.",
			};
		}

		const correctedGramsPerSecond = round2((beforeGps * measuredGrams) / target);
		if (
			correctedGramsPerSecond < GRAMS_PER_SECOND_MIN ||
			correctedGramsPerSecond > GRAMS_PER_SECOND_MAX
		) {
			return {
				success: false,
				error: `Corrected rate ${correctedGramsPerSecond} g/s is outside the supported ${GRAMS_PER_SECOND_MIN}–${GRAMS_PER_SECOND_MAX} g/s range. Check the weighed output and target dose.`,
			};
		}

		const errorPct = round2(((measuredGrams - target) / target) * 100);
		const accepted = Math.abs(errorPct) <= TARGET_CHECK_TOLERANCE_PCT;
		const { attempt, reTests } = await nextAttempt(deviceId, sessionId, "TARGET_CHECK");
		const createdById = await currentActorId();
		const gramsPerFeeding = device.gramsPerFeeding;
		const previousDurationSeconds = beforeGps > 0 ? round1(gramsPerFeeding / beforeGps) : 0;
		const newDurationSeconds = round1(gramsPerFeeding / correctedGramsPerSecond);
		const shouldSave = decision !== "retest";

		await prisma.energyDevice.update({
			where: { id: deviceId },
			data: {
				gramsPerSecond: correctedGramsPerSecond,
				...(shouldSave ? { lastCalibratedAt: new Date() } : {}),
			},
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "duration_calibrated",
				source: "user",
				actorId: ownerId,
				metadata: {
					oldGps: beforeGps,
					newGps: correctedGramsPerSecond,
					targetGrams: target,
					measuredGrams,
					errorPct,
					accepted,
					method: shouldSave ? "target_check" : "target_check_retest",
					requestId,
				},
			},
		});

		await prisma.calibrationRun.create({
			data: {
				deviceId,
				sessionId,
				attempt,
				kind: "TARGET_CHECK",
				durationMs: Math.round((target / beforeGps) * 1000),
				targetGrams: target,
				measuredGrams,
				gramsPerSecondBefore: beforeGps,
				gramsPerSecondAfter: correctedGramsPerSecond,
				errorPct,
				accepted,
				createdById,
			},
		});

		revalidateCalibrationPaths();

		return {
			success: true,
			attempt,
			reTests,
			errorPct,
			correctedGramsPerSecond,
			accepted,
			saved: shouldSave,
			previousGramsPerSecond: beforeGps,
			gramsPerFeeding,
			previousDurationSeconds,
			newDurationSeconds,
		};
	} catch (error) {
		console.error("Failed to submit calibration target check:", error);
		return { success: false, error: "Failed to save target check" };
	}
}

/**
 * Change how often a device should be recalibrated. The reminder cron and the
 * dashboard badge read this interval.
 */
export async function saveRecalibrationInterval(
	deviceId: string,
	intervalDays: number,
): Promise<{ success: boolean; error?: string }> {
	await requireWriteAccess();
	await requirePermission("manage_schedule");

	try {
		if (!isValidRecalibrationIntervalDays(intervalDays)) {
			return {
				success: false,
				error: "Recalibration interval must be a whole number between 7 and 180 days",
			};
		}

		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: { id: true, recalibrationIntervalDays: true },
		});

		if (!device) {
			return { success: false, error: "Device not found" };
		}

		await prisma.energyDevice.update({
			where: { id: deviceId },
			data: { recalibrationIntervalDays: intervalDays },
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "recalibration_interval_changed",
				source: "user",
				actorId: ownerId,
				metadata: {
					previousIntervalDays: device.recalibrationIntervalDays,
					recalibrationIntervalDays: intervalDays,
				},
			},
		});

		revalidateCalibrationPaths();

		return { success: true };
	} catch (error) {
		console.error("Failed to save recalibration interval:", error);
		return { success: false, error: "Failed to save recalibration interval" };
	}
}
