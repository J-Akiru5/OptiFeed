import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findFirst: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerIdSafe: vi.fn(),
	requireWriteAccess: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
}));

import { setDeviceTime } from "@/lib/actions/time";
import { getCurrentPondOwnerIdSafe, requireWriteAccess } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

const mockFindFirst = vi.mocked(prisma.energyDevice.findFirst);
const mockCreate = vi.mocked(prisma.deviceStateEvent.create);
const mockOwner = vi.mocked(getCurrentPondOwnerIdSafe);
const mockWrite = vi.mocked(requireWriteAccess);

beforeEach(() => {
	vi.clearAllMocks();
	mockWrite.mockResolvedValue(undefined);
	mockOwner.mockResolvedValue("farm-1");
	mockFindFirst.mockResolvedValue({ id: "dev-1" } as never);
	mockCreate.mockResolvedValue({} as never);
});

describe("setDeviceTime", () => {
	it("stores the absolute UTC instant for the device", async () => {
		const result = await setDeviceTime("dev-1", "2026-10-25T08:25:00.000Z");

		expect(result).toEqual({ success: true });
		expect(mockCreate).toHaveBeenCalledWith({
			data: expect.objectContaining({
				deviceId: "dev-1",
				eventType: "set_time",
				source: "user",
				deviceTime: "2026-10-25T08:25:00.000Z",
				metadata: { customTime: "2026-10-25T08:25:00.000Z" },
			}),
		});
	});

	it("rejects an invalid date without writing", async () => {
		const result = await setDeviceTime("dev-1", "not-a-date");

		expect(result.success).toBe(false);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("rejects a device outside the caller's farm", async () => {
		mockFindFirst.mockResolvedValue(null as never);

		const result = await setDeviceTime("dev-2", "2026-10-25T08:25:00.000Z");

		expect(result).toEqual({ success: false, error: "Device not found" });
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("fails closed without an owner", async () => {
		mockOwner.mockResolvedValue(null);

		const result = await setDeviceTime("dev-1", "2026-10-25T08:25:00.000Z");

		expect(result).toEqual({ success: false, error: "Not authenticated" });
		expect(mockCreate).not.toHaveBeenCalled();
	});
});
