import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/admin", () => ({ getDevicesForLabels: vi.fn() }));
vi.mock("@/i18n/routing", () => ({ Link: "a" }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn() }));
vi.mock("next/navigation", () => ({
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
}));

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
});
