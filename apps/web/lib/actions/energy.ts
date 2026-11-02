"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { createManualFeedRequest } from "@/lib/feed/commands";
import {
	DEFAULT_HOPPER_BULK_DENSITY_G_CM3,
	GRAMS_PER_SECOND_MAX,
	GRAMS_PER_SECOND_MIN,
	MIN_FEED_TEMP_C_MAX,
	MIN_FEED_TEMP_C_MIN,
	formatZodError,
	hopperCalibrationSchema,
	hopperCapacityFromGeometry,
} from "@/lib/limits";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

// The caps and the full command sequence live in lib/feed/commands.ts, shared
// with superadmin remote control (plan M5.2). STALE_DISPATCHED_MS there is 10
// minutes, twice the 5-minute MAX_DISPENSE_MS relay window, so no accepted
// dose can still be running when a stale dispatched request expires.

export async function requestFeed(deviceId: string, grams?: number) {
	// Guard outside try: the catch below returns a generic message and would
	// hide the write-access reason from the caller (matches toggleDevicePause).
	await requireWriteAccess();
	await requirePermission("control_feeder");
	try {
		const ownerId = await getCurrentPondOwnerId();
		const outcome = await createManualFeedRequest(prisma, {
			deviceId,
			grams,
			farmId: ownerId,
			actorId: ownerId,
			triggerSource: "energy_actions",
		});

		if (!outcome.ok) {
			return { success: false, error: outcome.error };
		}
		if (outcome.alreadyPending) {
			return { success: true, message: "Feed already pending" };
		}

		revalidatePath("/[locale]/(dashboard)/dashboard", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard/schedule", "page");
		return { success: true };
	} catch (error) {
		console.error("Failed to create feed request:", error);
		return { success: false, error: "Failed to create feed request" };
	}
}

export async function saveHopperCalibration(
	deviceId: string,
	data: {
		hopperFullCm: number;
		hopperEmptyCm: number;
		/** Legacy/manual capacity; used only when no diameter is supplied. */
		hopperCapacityG?: number;
		/** Issue #415: geometry that lets the server compute the capacity. */
		hopperDiameterCm?: number;
		hopperBulkDensityGCm3?: number;
	},
) {
	try {
		await requireWriteAccess();
		await requirePermission("manage_schedule");

		// A server action is a public entry point: the form bounds are not a
		// guard. A zero capacity silently raises the daily feed cap to the hard
		// maximum, and NaN or an inverted full/empty pair makes every feed-level
		// percentage meaningless on the device.
		const parsed = hopperCalibrationSchema.safeParse(data);
		if (!parsed.success) {
			return { success: false, error: formatZodError(parsed.error) };
		}

		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: { id: true, hopperCapacityG: true, hopperDiameterCm: true },
		});

		if (!device) {
			return { success: false, error: "Device not found" };
		}

		// The capacity is derived here, never trusted from the client: the
		// stored number feeds the daily-cap ceiling and the days-of-feed
		// estimate, so the server recomputes it from the same pure helper the
		// form previews. A save without a diameter keeps the capacity the
		// device already had (rows calibrated before #415).
		const density = parsed.data.hopperBulkDensityGCm3 ?? DEFAULT_HOPPER_BULK_DENSITY_G_CM3;
		const computedCapacity =
			parsed.data.hopperDiameterCm === undefined
				? null
				: hopperCapacityFromGeometry(
						{
							diameterCm: parsed.data.hopperDiameterCm,
							fullCm: parsed.data.hopperFullCm,
							emptyCm: parsed.data.hopperEmptyCm,
						},
						density,
					);
		const capacityG = computedCapacity ?? parsed.data.hopperCapacityG ?? device.hopperCapacityG;
		if (capacityG === null || capacityG === undefined) {
			return { success: false, error: "Enter the tank diameter or a capacity in grams" };
		}

		await prisma.energyDevice.update({
			where: { id: deviceId },
			data: {
				hopperFullCm: parsed.data.hopperFullCm,
				hopperEmptyCm: parsed.data.hopperEmptyCm,
				hopperCapacityG: capacityG,
				// Clearing the diameter in the form falls back to the stored
				// capacity; the previous geometry stays available for the size
				// the tank actually has.
				hopperDiameterCm: parsed.data.hopperDiameterCm ?? device.hopperDiameterCm,
				hopperBulkDensityGCm3:
					parsed.data.hopperDiameterCm === undefined
						? undefined
						: (parsed.data.hopperBulkDensityGCm3 ?? DEFAULT_HOPPER_BULK_DENSITY_G_CM3),
			},
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "hopper_calibrated",
				source: "user",
				actorId: ownerId,
				metadata: {
					hopperFullCm: parsed.data.hopperFullCm,
					hopperEmptyCm: parsed.data.hopperEmptyCm,
					hopperCapacityG: capacityG,
					...(parsed.data.hopperDiameterCm === undefined
						? {}
						: {
								hopperDiameterCm: parsed.data.hopperDiameterCm,
								hopperBulkDensityGCm3: density,
								computed: true,
							}),
				},
			},
		});

		revalidatePath("/[locale]/(dashboard)/dashboard/settings/hardware", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard", "page");
		return { success: true };
	} catch (error) {
		console.error("Failed to save hopper calibration:", error);
		return { success: false, error: "Failed to save hopper calibration" };
	}
}

export async function saveDurationCalibration(deviceId: string, gramsPerSecond: number) {
	try {
		await requireWriteAccess();
		await requirePermission("manage_schedule");
		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: { id: true },
		});

		if (!device) {
			return { success: false, error: "Device not found" };
		}

		if (
			!Number.isFinite(gramsPerSecond) ||
			gramsPerSecond < GRAMS_PER_SECOND_MIN ||
			gramsPerSecond > GRAMS_PER_SECOND_MAX
		) {
			return {
				success: false,
				error: `Grams per second must be between ${GRAMS_PER_SECOND_MIN} and ${GRAMS_PER_SECOND_MAX}`,
			};
		}

		await prisma.energyDevice.update({
			where: { id: deviceId },
			data: { gramsPerSecond },
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "duration_calibrated",
				source: "user",
				actorId: ownerId,
				metadata: { gramsPerSecond },
			},
		});

		revalidatePath("/[locale]/(dashboard)/dashboard/settings/hardware", "page");
		return { success: true };
	} catch (error) {
		console.error("Failed to save duration calibration:", error);
		return { success: false, error: "Failed to save duration calibration" };
	}
}

/**
 * Saves the DS18B20 calibration offset and, when given, the warn-only minimum
 * feeding temperature (issue #486).
 *
 * `minFeedTempC` is three-valued on purpose:
 *  - omitted  → leave the stored threshold alone (older callers keep working);
 *  - `null`   → clear it, so the dashboard stops warning on this device;
 *  - a number → replace it.
 *
 * The threshold never blocks a feed. It only lets the dashboard say the water is
 * colder than the pond's own limit, which is why the bounds are a sanity range
 * rather than a recommendation.
 */
export async function saveTemperatureCalibration(
	deviceId: string,
	tempOffsetC: number,
	minFeedTempC?: number | null,
) {
	try {
		await requireWriteAccess();
		await requirePermission("manage_schedule");
		const ownerId = await getCurrentPondOwnerId();
		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: { id: true },
		});

		if (!device) {
			return { success: false, error: "Device not found" };
		}

		if (!Number.isFinite(tempOffsetC) || tempOffsetC < -20 || tempOffsetC > 20) {
			return { success: false, error: "Temperature offset must be between -20 and 20 °C" };
		}

		if (
			minFeedTempC !== undefined &&
			minFeedTempC !== null &&
			(!Number.isFinite(minFeedTempC) ||
				minFeedTempC < MIN_FEED_TEMP_C_MIN ||
				minFeedTempC > MIN_FEED_TEMP_C_MAX)
		) {
			return {
				success: false,
				error: `Minimum feeding temperature must be between ${MIN_FEED_TEMP_C_MIN} and ${MIN_FEED_TEMP_C_MAX} °C`,
			};
		}

		await prisma.energyDevice.update({
			where: { id: deviceId },
			data: { tempOffsetC, ...(minFeedTempC === undefined ? {} : { minFeedTempC }) },
		});

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "temperature_calibrated",
				source: "user",
				actorId: ownerId,
				metadata: { tempOffsetC, ...(minFeedTempC === undefined ? {} : { minFeedTempC }) },
			},
		});

		revalidatePath("/[locale]/(dashboard)/dashboard/settings/hardware", "page");
		// The dashboard card shows the warning, so it must re-read the threshold.
		revalidatePath("/[locale]/(dashboard)/dashboard", "page");
		return { success: true };
	} catch (error) {
		console.error("Failed to save temperature calibration:", error);
		return { success: false, error: "Failed to save temperature calibration" };
	}
}
