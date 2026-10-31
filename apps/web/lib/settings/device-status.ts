import {
	DEVICE_STATUS_DEFAULT_VALUE,
	DEVICE_STATUS_SETTING_KEY,
	type DeviceStatusPolicy,
	type DeviceStatusSettingValue,
	deviceStatusPolicyFromValue,
	normalizeDeviceStatusValue,
} from "@/lib/device-status";
import prisma from "@/lib/prisma";
import { cache } from "react";

/**
 * Platform-configurable device connectivity thresholds (issue #388).
 *
 * Stored in the existing `PlatformSetting` key/value table, so no schema change
 * is needed. A missing row, a missing table or a transient read failure returns
 * the defaults; a stored value is normalised before use. `cache` keeps one read
 * per rendered request even when several device surfaces render together.
 */
export const getDeviceStatusSetting = cache(async (): Promise<DeviceStatusSettingValue> => {
	try {
		const row = await prisma.platformSetting.findUnique({
			where: { key: DEVICE_STATUS_SETTING_KEY },
			select: { value: true },
		});
		return normalizeDeviceStatusValue(row?.value ?? DEVICE_STATUS_DEFAULT_VALUE);
	} catch {
		return { ...DEVICE_STATUS_DEFAULT_VALUE };
	}
});

export const getDeviceStatusPolicy = cache(async (): Promise<DeviceStatusPolicy> => {
	return deviceStatusPolicyFromValue(await getDeviceStatusSetting());
});
