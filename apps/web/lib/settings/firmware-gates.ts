import {
	FIRMWARE_DEFAULTS,
	FIRMWARE_GATES_SETTING_KEY,
	type FirmwareValues,
	normalizeFirmwareValues,
} from "@/lib/firmware/config";
import prisma from "@/lib/prisma";
import { cache } from "react";

/**
 * Stored dashboard values for the firmware config (I-100).
 *
 * `PlatformSetting` key `firmware.gates`; no schema change. A missing row, a
 * missing table or a transient read failure returns the compile-time defaults,
 * so the feed-command poll can always answer with a complete, envelope-bounded
 * config object. A stored value is normalised (clamped) before use.
 */
export const getFirmwareGates = cache(async (): Promise<FirmwareValues> => {
	try {
		const row = await prisma.platformSetting.findUnique({
			where: { key: FIRMWARE_GATES_SETTING_KEY },
			select: { value: true },
		});
		return normalizeFirmwareValues(row?.value ?? FIRMWARE_DEFAULTS);
	} catch {
		return { ...FIRMWARE_DEFAULTS };
	}
});
