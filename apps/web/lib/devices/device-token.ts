import { isStepUpRequiredError } from "@/lib/auth/step-up";
import prisma from "@/lib/prisma";

export type RevealedDeviceToken = {
	token: string;
	mac: string;
	label: string;
};

/**
 * Read one approved device credential and write its `token_revealed` audit row.
 *
 * Extracted from `revealDeviceToken` so the server action keeps its guards and
 * step-up branch while the file-level complexity budget stays intact. The
 * caller supplies the already-resolved tenant scope; `in: []` matches nothing,
 * so an empty scope is indistinguishable from a device in another tenant.
 *
 * The credential is deliberately absent from the audit row: the trail records
 * who looked, not what they saw.
 */
export async function readAndAuditDeviceToken(input: {
	deviceId: string;
	/** Pond ids in the caller's org scope. */
	pondIds: readonly string[];
	actorId: string;
}): Promise<RevealedDeviceToken | null> {
	const device = await prisma.energyDevice.findFirst({
		where: {
			id: input.deviceId,
			pondId: { in: [...input.pondIds] },
			// A PENDING/REJECTED device is not revealable: its token exists but
			// must stay hidden until an org admin approves the unit.
			approvalStatus: "APPROVED",
		},
		select: { token: true, mac: true, label: true },
	});
	if (!device) return null;

	await prisma.deviceStateEvent.create({
		data: {
			deviceId: input.deviceId,
			eventType: "token_revealed",
			source: "user",
			actorId: input.actorId,
		},
	});

	return device;
}

export type DeviceTokenRevealFailure = {
	success: false;
	error: string;
	code?: "step_up_required";
};

/**
 * Map a reveal failure to the action's typed result.
 *
 * Kept next to the read helper so `revealDeviceToken` stays within the file
 * complexity budget while preserving the step-up code the dialog needs and the
 * no-credential logging rule.
 */
export function deviceTokenRevealFailure(error: unknown): DeviceTokenRevealFailure {
	if (isStepUpRequiredError(error)) {
		return { success: false, error: error.message, code: "step_up_required" };
	}
	console.error(
		"[admin] revealDeviceToken error:",
		error instanceof Error ? error.message : "unknown error",
	);
	return { success: false, error: "Failed to load the device token." };
}
