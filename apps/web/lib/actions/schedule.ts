"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { resolveActivePond } from "@/lib/auth/pond-access";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { STALE_SENT_MS } from "@/lib/constants";
import { parseCsvTable } from "@/lib/csv";
import { syncDeviceGramsForPond } from "@/lib/feed-grams";
import { setSchedulePause } from "@/lib/feed/commands";
import { resolveDeviceDose } from "@/lib/feeding/derive";
import { MAX_CSV_IMPORT_BYTES } from "@/lib/jobs/import-data";
import { formatZodError, resolveDailyCapG, scheduleInputSchema } from "@/lib/limits";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { getFeedingLimits } from "@/lib/settings/feeding-caps";
import { detectDoseViolation } from "@/lib/settings/pond-conflicts";
import { prepareImport } from "@/lib/xlsx/prepare";
import { revalidatePath } from "next/cache";

export async function toggleDevicePause(deviceId: string, isPaused: boolean) {
	// Guard outside try: the catch below rethrows a generic message and would
	// hide the write-access reason from the caller.
	await requireWriteAccess();
	await requirePermission("control_feeder");
	try {
		const ownerId = await getCurrentPondOwnerId();

		// Same pause implementation as superadmin remote control (plan M5.2).
		const outcome = await setSchedulePause(prisma, {
			deviceId,
			isPaused,
			actorId: ownerId,
			farmId: ownerId,
		});
		if (!outcome.ok) {
			throw new Error(outcome.code === "pond_fallow" ? "POND_FALLOW" : outcome.error);
		}

		revalidatePath("/[locale]/(dashboard)/dashboard/schedule", "page");
	} catch (error) {
		if (error instanceof Error && error.message === "POND_FALLOW") {
			throw new Error(
				"This pond is fallow after harvest. Start the next grow-out cycle before resuming feeding.",
			);
		}
		console.error("Failed to toggle device pause:", error);
		throw new Error("Failed to toggle device pause");
	}
}

export interface UpdateScheduleResult {
	success: boolean;
	commandId?: string;
	error?: string;
}

// STALE_SENT_MS (lib/constants.ts): 10 minutes — the device should ack
// within the dispense window; past this, something went wrong.

export async function updateScheduleCommand(
	pondId: string,
	deviceId: string,
	data: {
		scheduleStart: string; // "HH:MM" 24h
		scheduleEnd: string; // "HH:MM" 24h
		feedsPerDay: number;
		feedingRatePct: number;
		buttonFeedGrams?: number;
		/**
		 * The fish count the dose is derived from, when the caller has already
		 * changed it and the pond row still holds the old one (#430).
		 */
		population?: number | null;
	},
): Promise<UpdateScheduleResult> {
	// Guard outside try: the catch below returns a generic message and would
	// hide the write-access reason from the caller (matches toggleDevicePause).
	await requireWriteAccess();
	await requirePermission("manage_schedule");
	try {
		const parsed = scheduleInputSchema.safeParse(data);
		if (!parsed.success) {
			return { success: false, error: formatZodError(parsed.error) };
		}
		const input = parsed.data;

		const ownerId = await getCurrentPondOwnerId();

		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pondId, pond: { ownerId } },
			include: { pond: { select: { isFallow: true } } },
		});
		if (!device) return { success: false, error: "Device not found or access denied" };
		if (device.pond?.isFallow) {
			return {
				success: false,
				error:
					"This pond is fallow after harvest. Start the next grow-out cycle before changing the feeding schedule.",
			};
		}

		const limits = await getFeedingLimits();
		const dailyCapG = resolveDailyCapG({
			configuredCapG: device.dailyCapG,
			hopperCapacityG: device.hopperCapacityG,
			dailyCapFactor: limits.dailyCapFactor,
		});

		// The dose the feeder will run after this change (#430): the derived one
		// when the pond has a sample, otherwise the dose it runs today. Checking
		// the stored dose alone let this path write a dose the feeder cannot run
		// in one relay window, which then blocked every later pond edit.
		const derived = await resolveDeviceDose(pondId, {
			feedingRatePct: input.feedingRatePct,
			feedsPerDay: input.feedsPerDay,
			// A caller that already changed the fish count passes it here, so the
			// dose that is checked is the dose it is about to write (#430).
			...(typeof input.population === "number" ? { population: input.population } : {}),
		});
		const effectiveGrams = derived.grams ?? device.gramsPerFeeding;
		const violation = detectDoseViolation({
			grams: effectiveGrams,
			feedsPerDay: input.feedsPerDay,
			constraints: {
				gramsPerSecond: device.gramsPerSecond,
				maxDispenseMs: limits.maxDispenseMs,
				effectiveDailyCapG: dailyCapG,
			},
		});
		if (violation === "relay-time") {
			return {
				success: false,
				error: `Feed amount of ${Math.round(effectiveGrams)} g would take more than ${limits.maxDispenseMs / 1000} s of relay time at ${device.gramsPerSecond} g/s. Add more meals per day or reduce the feed amount.`,
			};
		}
		if (violation === "daily-ceiling") {
			const scheduledDailyG = effectiveGrams * input.feedsPerDay;
			return {
				success: false,
				error: `Schedule would dispense ${Math.round(scheduledDailyG)} g/day — over the ${Math.round(dailyCapG)} g/day limit. Lower feeds per day or the feed amount.`,
			};
		}

		// Expire stale sent commands that were picked up by the device
		// but never acked. Prevents zombie commands from blocking future edits.
		const staleCommands = await prisma.scheduleCommand.findMany({
			where: {
				deviceId,
				status: "sent",
				updatedAt: { lt: new Date(Date.now() - STALE_SENT_MS) },
			},
		});

		for (const cmd of staleCommands) {
			await prisma.scheduleCommand.update({
				where: { id: cmd.id },
				data: { status: "failed" },
			});

			await prisma.deviceStateEvent.create({
				data: {
					deviceId,
					eventType: "command_failed",
					source: "system",
					metadata: {
						commandId: cmd.id,
						scheduleStart: `${String(cmd.scheduleStart.getUTCHours()).padStart(2, "0")}:${String(cmd.scheduleStart.getUTCMinutes()).padStart(2, "0")}`,
						scheduleEnd: `${String(cmd.scheduleEnd.getUTCHours()).padStart(2, "0")}:${String(cmd.scheduleEnd.getUTCMinutes()).padStart(2, "0")}`,
					},
				},
			});
		}

		const [startHours, startMinutes] = input.scheduleStart.split(":").map(Number);
		const [endHours, endMinutes] = input.scheduleEnd.split(":").map(Number);

		const scheduleStart = new Date();
		scheduleStart.setUTCHours(startHours, startMinutes, 0, 0);
		const scheduleEnd = new Date();
		scheduleEnd.setUTCHours(endHours, endMinutes, 0, 0);

		const command = await prisma.scheduleCommand.create({
			data: {
				deviceId,
				pondId,
				scheduleStart,
				scheduleEnd,
				feedsPerDay: input.feedsPerDay,
				feedingRatePct: input.feedingRatePct,
				buttonFeedGrams: input.buttonFeedGrams ?? 80,
				status: "pending",
				createdBy: ownerId,
			},
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "schedule_changed",
				source: "user",
				actorId: ownerId,
				metadata: {
					commandId: command.id,
					scheduleStart: input.scheduleStart,
					scheduleEnd: input.scheduleEnd,
					feedsPerDay: input.feedsPerDay,
					feedingRatePct: input.feedingRatePct,
				},
			},
		});

		// Keep the device's dispensed grams in sync with the new rate/feeds config.
		await syncDeviceGramsForPond(pondId, {
			feedsPerDay: input.feedsPerDay,
			feedingRatePct: input.feedingRatePct,
		});

		revalidatePath("/[locale]/(dashboard)/dashboard/schedule", "page");
		return { success: true, commandId: command.id };
	} catch (error) {
		console.error("Failed to create schedule command:", error);
		return { success: false, error: "Failed to create schedule command" };
	}
}

/**
 * Apply a feeding schedule imported from a sheet (I-107). The canonical CSV the
 * preview produced is validated again here, never trusted, and the window and
 * meal count it describes go through `updateScheduleCommand`, so the daily cap,
 * the relay-time guard, the fallow check and the audit event all apply. The
 * feeding rate and the button feed amount are kept as they are.
 */
export async function importFeedingSchedule(csvData: string): Promise<UpdateScheduleResult> {
	await requireWriteAccess();
	await requirePermission("manage_schedule");

	if (
		typeof csvData !== "string" ||
		csvData.length === 0 ||
		csvData.length > MAX_CSV_IMPORT_BYTES
	) {
		return { success: false, error: "The schedule file is empty or too large." };
	}

	const { headers, rows } = parseCsvTable(csvData);
	const prepared = prepareImport({ type: "feeding_schedule", headers, rows });
	if (prepared.structural || prepared.issueCount > 0 || !prepared.schedule) {
		return {
			success: false,
			error: "The schedule file is not valid. Check the preview and try again.",
		};
	}

	const ownerId = await getCurrentPondOwnerId();
	const pond = await resolveActivePond(ownerId);
	if (!pond) return { success: false, error: "No pond found." };
	const device = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
		select: { id: true, buttonFeedGrams: true },
	});
	if (!device) return { success: false, error: "No feeder is paired to this pond." };

	const current = await resolveCurrentSchedule(pond.id, device.id);
	return updateScheduleCommand(pond.id, device.id, {
		...prepared.schedule,
		feedingRatePct: current?.feedingRatePct ?? pond.feedingRatePct,
		buttonFeedGrams: device.buttonFeedGrams,
	});
}
