import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Warn-only minimum feeding temperature (issue #486).
 *
 * The three-valued third argument is the whole point of these tests: omitted must
 * leave an existing limit alone, null must clear it, and an out-of-range number
 * must be rejected without touching the row. A limit that silently became "no
 * limit" (or 0 °C) would warn forever, which is why each path is asserted.
 */

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findFirst: vi.fn(), update: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn().mockResolvedValue("farm-1"),
	requireWriteAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth/permissions", () => ({
	requirePermission: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveTemperatureCalibration } from "@/lib/actions/energy";
import { MIN_FEED_TEMP_C_MAX, MIN_FEED_TEMP_C_MIN } from "@/lib/limits";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);
const mockRevalidatePath = vi.mocked(revalidatePath);

beforeEach(() => {
	vi.clearAllMocks();
	mockEnergyDevice.findFirst.mockResolvedValue({ id: "device-1" } as never);
	mockEnergyDevice.update.mockResolvedValue({} as never);
	mockDeviceStateEvent.create.mockResolvedValue({} as never);
});

describe("saveTemperatureCalibration — minimum feeding temperature", () => {
	it("stores the offset and the threshold together", async () => {
		const result = await saveTemperatureCalibration("device-1", -0.7, 24);

		expect(result).toEqual({ success: true });
		expect(mockEnergyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: { tempOffsetC: -0.7, minFeedTempC: 24 },
		});
		expect(mockDeviceStateEvent.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				eventType: "temperature_calibrated",
				metadata: { tempOffsetC: -0.7, minFeedTempC: 24 },
			}),
		});
	});

	it("re-reads both surfaces that show the value", async () => {
		await saveTemperatureCalibration("device-1", 0, 24);

		const paths = mockRevalidatePath.mock.calls.map((call) => call[0]);
		expect(paths).toContain("/[locale]/(dashboard)/dashboard/settings/hardware");
		expect(paths).toContain("/[locale]/(dashboard)/dashboard");
	});

	it("clears the threshold when given null", async () => {
		await saveTemperatureCalibration("device-1", 0, null);

		expect(mockEnergyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: { tempOffsetC: 0, minFeedTempC: null },
		});
	});

	it("leaves an existing threshold alone when the argument is omitted", async () => {
		await saveTemperatureCalibration("device-1", 0.5);

		expect(mockEnergyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: { tempOffsetC: 0.5 },
		});
		const metadata = mockDeviceStateEvent.create.mock.calls[0][0] as {
			data: { metadata: Record<string, unknown> };
		};
		expect(metadata.data.metadata).not.toHaveProperty("minFeedTempC");
	});

	it.each([
		["below the floor", MIN_FEED_TEMP_C_MIN - 0.1],
		["above the ceiling", MIN_FEED_TEMP_C_MAX + 0.1],
		["not a number", Number.NaN],
		["infinite", Number.POSITIVE_INFINITY],
	])("rejects a threshold %s without writing", async (_label, value) => {
		const result = await saveTemperatureCalibration("device-1", 0, value);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Minimum feeding temperature");
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("accepts the bounds themselves", async () => {
		expect((await saveTemperatureCalibration("device-1", 0, MIN_FEED_TEMP_C_MIN)).success).toBe(
			true,
		);
		expect((await saveTemperatureCalibration("device-1", 0, MIN_FEED_TEMP_C_MAX)).success).toBe(
			true,
		);
	});

	it("still rejects an out-of-range offset", async () => {
		const result = await saveTemperatureCalibration("device-1", 21, 24);

		expect(result.success).toBe(false);
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});

	it("refuses a device outside the caller's farm", async () => {
		mockEnergyDevice.findFirst.mockResolvedValue(null);

		const result = await saveTemperatureCalibration("device-other", 0, 24);

		expect(result).toMatchObject({ success: false });
		expect(mockEnergyDevice.update).not.toHaveBeenCalled();
	});
});
