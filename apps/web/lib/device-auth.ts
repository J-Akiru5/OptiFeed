import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import prisma from "@/lib/prisma";

/** sha256 of a device token, hex-encoded — matches the DB backfill. */
export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** Mint a new provisioning token. Display once; store the hash. */
export function generateDeviceToken(): string {
	return `esp32-tok-${randomBytes(16).toString("hex")}`;
}

/**
 * Resolve a device from its plaintext token.
 *
 * Lookups go through the SHA-256 hash column (never the plaintext), then a
 * constant-time comparison confirms the match. Returns the full device row
 * or null when the token is unknown/mismatched.
 */
export async function verifyDeviceToken(token: string) {
	const tokenHash = hashToken(token);
	const device = await prisma.energyDevice.findUnique({
		where: { tokenHash },
	});
	if (!device?.tokenHash) return null;

	const expected = Buffer.from(tokenHash, "hex");
	const actual = Buffer.from(device.tokenHash, "hex");
	if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
		return null;
	}
	return device;
}

/**
 * Org device-registration policy (issue #190): a PENDING or REJECTED device is
 * authenticated as a row but gets no data or commands. The device routes answer
 * 403 for these, which is distinct from the 401 an unknown token receives.
 */
export function isDeviceApproved(device: { approvalStatus?: string | null }): boolean {
	return device.approvalStatus === "APPROVED";
}
