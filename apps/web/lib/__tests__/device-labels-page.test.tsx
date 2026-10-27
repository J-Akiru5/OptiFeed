import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/admin", () => ({ getDevicesForLabels: vi.fn() }));
vi.mock("@/i18n/routing", () => ({ Link: "a" }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn() }));
vi.mock("next/navigation", () => ({
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
}));
// The page returns the shared sheet; these are the sheet's own dependencies and
// are not what this test exercises.
vi.mock("@/lib/auth/require-platform-admin", () => ({ isCurrentPlatformAdmin: vi.fn() }));
vi.mock("@/lib/auth/tenant-admin", () => ({ getTenantAdminState: vi.fn() }));
vi.mock("@/lib/settings/sticker-rating", () => ({ getStickerRatingDefault: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));

import DeviceLabelsPage from "@/app/[locale]/(print)/admin/devices/labels/page";
import { getDevicesForLabels } from "@/lib/actions/admin";

const mockGetDevicesForLabels = vi.mocked(getDevicesForLabels);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("device labels page", () => {
	it("answers not found when no requested device is in scope", async () => {
		mockGetDevicesForLabels.mockResolvedValue([]);
		await expect(
			DeviceLabelsPage({ searchParams: Promise.resolve({ id: "dev-b1" }) }),
		).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("accepts one id, a repeated id parameter, or none", async () => {
		mockGetDevicesForLabels.mockResolvedValue([]);
		await expect(
			DeviceLabelsPage({ searchParams: Promise.resolve({ id: ["a", "b"] }) }),
		).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mockGetDevicesForLabels).toHaveBeenLastCalledWith(["a", "b"]);

		await expect(DeviceLabelsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
			"NEXT_NOT_FOUND",
		);
		expect(mockGetDevicesForLabels).toHaveBeenLastCalledWith([]);
	});

	it("passes the per-print rating params through to the sheet", async () => {
		const devices = [{ id: "dev-a1", label: "Feeder 1", mac: "A4:CF:12:7E:3B:09" }];
		mockGetDevicesForLabels.mockResolvedValue(devices);
		const searchParams = { id: "dev-a1", voltage: "230", hz: "50", measured: "1" };

		const element = await DeviceLabelsPage({ searchParams: Promise.resolve(searchParams) });

		expect(element.props).toEqual(
			expect.objectContaining({
				devices,
				backHref: "/admin/devices",
				searchParams,
			}),
		);
	});
});
