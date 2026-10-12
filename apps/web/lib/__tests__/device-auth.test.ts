import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: { energyDevice: { findUnique: vi.fn() } },
}));

import { generateDeviceToken, hashToken, verifyDeviceToken } from "@/lib/device-auth";
import prisma from "@/lib/prisma";

const findUnique = vi.mocked(prisma.energyDevice.findUnique);

describe("hashToken", () => {
	it("is sha256 hex of the token", () => {
		expect(hashToken("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
		expect(hashToken("abc")).toHaveLength(64);
	});
});

describe("generateDeviceToken", () => {
	it("mints unique esp32-tok- prefixed tokens", () => {
		const a = generateDeviceToken();
		const b = generateDeviceToken();
		expect(a).toMatch(/^esp32-tok-[0-9a-f]{32}$/);
		expect(a).not.toBe(b);
	});
});

describe("verifyDeviceToken", () => {
	beforeEach(() => {
		findUnique.mockReset();
	});

	it("returns the device when the hash lookup matches", async () => {
		const token = "esp32-tok-test";
		const row = { id: "dev-1", tokenHash: hashToken(token) };
		findUnique.mockResolvedValue(row as never);

		expect(await verifyDeviceToken(token)).toBe(row);
		expect(findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashToken(token) } });
	});

	it("returns null for an unknown token", async () => {
		findUnique.mockResolvedValue(null);
		expect(await verifyDeviceToken("wrong")).toBeNull();
	});

	it("returns null when the stored hash does not match (timing-safe compare)", async () => {
		// Row found via a colliding/incorrectly written hash column.
		findUnique.mockResolvedValue({ id: "dev-2", tokenHash: hashToken("other") } as never);
		expect(await verifyDeviceToken("esp32-tok-test")).toBeNull();
	});
});
