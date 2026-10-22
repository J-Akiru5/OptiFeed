import { isPlatformAdminActive } from "@/lib/auth/platform-admin";
import { describe, expect, it } from "vitest";

const NOW = new Date("2026-10-17T00:00:00.000Z");

function minutes(n: number): Date {
	return new Date(NOW.getTime() + n * 60_000);
}

describe("isPlatformAdminActive", () => {
	it("is active with no revocation and no expiry", () => {
		expect(isPlatformAdminActive({ revokedAt: null, expiresAt: null }, NOW)).toBe(true);
	});

	it("is inactive when revoked", () => {
		expect(isPlatformAdminActive({ revokedAt: minutes(-1), expiresAt: null }, NOW)).toBe(false);
	});

	it("is inactive when expired", () => {
		expect(isPlatformAdminActive({ revokedAt: null, expiresAt: minutes(-1) }, NOW)).toBe(false);
	});

	it("is active when expiry is in the future", () => {
		expect(isPlatformAdminActive({ revokedAt: null, expiresAt: minutes(1) }, NOW)).toBe(true);
	});

	it("is inactive when expiry is exactly now (fail-closed)", () => {
		expect(isPlatformAdminActive({ revokedAt: null, expiresAt: NOW }, NOW)).toBe(false);
	});

	it("is revoked even if the expiry is still in the future", () => {
		expect(isPlatformAdminActive({ revokedAt: minutes(-1), expiresAt: minutes(1) }, NOW)).toBe(
			false,
		);
	});

	it("defaults now to the current clock", () => {
		const future = new Date(Date.now() + 60_000);
		const past = new Date(Date.now() - 60_000);
		expect(isPlatformAdminActive({ revokedAt: null, expiresAt: future })).toBe(true);
		expect(isPlatformAdminActive({ revokedAt: null, expiresAt: past })).toBe(false);
	});
});
