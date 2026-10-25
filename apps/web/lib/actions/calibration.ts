"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { STALE_DISPATCHED_MS } from "@/lib/constants";
import {
	CALIBRATION_ACTUAL_GRAMS_MAX,
	CALIBRATION_TEST_GRAMS_MAX,
	CALIBRATION_TEST_SECONDS_MAX,
	CALIBRATION_TEST_SECONDS_MIN,
	GRAMS_PER_SECOND_MAX,
	GRAMS_PER_SECOND_MIN,
	OFFLINE_THRESHOLD_MS,
	dailyFeedCapG,
} from "@/lib/limits";
import prisma from "@/lib/prisma";
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
}

const TEST_SECONDS_ERROR = `Test duration must be a whole number between ${CALIBRATION_TEST_SECONDS_MIN} and ${CALIBRATION_TEST_SECONDS_MAX} seconds`;

const TEST_DOSE_RANGE_ERROR = `Test dose would dispense outside the supported 1–${CALIBRATION_TEST_GRAMS_MAX} g range. Shorten the test duration.`;

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
): Promise<CalibrationTestResult> {
	// Guard outside try: the catch below returns a generic message and would
	// hide the write-access/permission reason from the caller.
	await requireWriteAccess();
	await requirePermission("manage_schedule");
	await requirePermission("control_feeder");

	try {
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
		const dailyCapG = dailyFeedCapG(device.hopperCapacityG);
		if (usedTodayG + testGrams > dailyCapG) {
			return {
				success: false,
				error: `Daily feed limit reached — ${Math.round(dailyCapG)} g/day cap with ${Math.round(usedTodayG)} g already used today. Try again after midnight (Asia/Manila).`,
			};
		}

		const request = await prisma.feedRequest.create({
			data: {
				deviceId,
				grams: testGrams,
				status: "pending",
			},
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "calibration_test_queued",
				source: "user",
				actorId: ownerId,
				metadata: {
					requestId: request.id,
					testSeconds,
					testGrams,
					gramsPerSecond: device.gramsPerSecond,
					method: "test_dose",
				},
			},
		});

		revalidateCalibrationPaths();

		return {
			success: true,
			requestId: request.id,
			testGrams,
			expectedSeconds: round1(testGrams / device.gramsPerSecond),
		};
	} catch (error) {
		console.error("Failed to queue calibration test:", error);
		return { success: false, error: "Failed to create calibration test" };
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
 */
export async function saveCalibrationFromTest(
	deviceId: string,
	requestId: string,
	testSeconds: number,
	actualGrams: number,
): Promise<CalibrationSaveResult> {
	await requireWriteAccess();
	await requirePermission("manage_schedule");

	try {
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

		await prisma.energyDevice.update({
			where: { id: deviceId },
			data: { gramsPerSecond: newGramsPerSecond },
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

		revalidateCalibrationPaths();

		return {
			success: true,
			previousGramsPerSecond,
			newGramsPerSecond,
			gramsPerFeeding,
			previousDurationSeconds,
			newDurationSeconds,
		};
	} catch (error) {
		console.error("Failed to save calibration from test dose:", error);
		return { success: false, error: "Failed to save calibration" };
	}
}
