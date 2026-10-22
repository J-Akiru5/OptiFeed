import type { Prisma } from "@prisma/client";

/**
 * Deletes a farmer's entire record in FK-safe order: event rows and devices
 * (RESTRICT), then ponds, then the Farm (CASCADE target), then the User.
 *
 * Plain server-only module — deliberately without "use server": this runs
 * inside a caller's transaction and must never be exposed as a callable
 * server action. Callers (admin.ts, superadmin.ts) already gate on
 * requireRole("ADMIN") / requirePlatformAdmin().
 *
 * Note: Membership has no FK relation to User (by design), so callers that
 * remove a user must delete its Membership rows themselves.
 */
export async function deleteUserSubtree(
	client: Prisma.TransactionClient,
	userId: string,
	farmId: string,
): Promise<void> {
	const pondIds = (
		await client.pond.findMany({ where: { ownerId: farmId }, select: { id: true } })
	).map((p) => p.id);

	if (pondIds.length > 0) {
		const wherePond = { pondId: { in: pondIds } };
		const whereDevicePond = { device: { pondId: { in: pondIds } } };

		await client.feedLevelLog.deleteMany({ where: whereDevicePond });
		await client.feedRequest.deleteMany({ where: whereDevicePond });
		await client.feedEvent.deleteMany({ where: whereDevicePond });
		await client.deviceStateEvent.deleteMany({ where: whereDevicePond });
		await client.scheduleCommand.deleteMany({
			where: { OR: [whereDevicePond, wherePond] },
		});
		await client.notification.deleteMany({ where: wherePond });
		await client.fcrReport.deleteMany({ where: wherePond });
		await client.biomassLog.deleteMany({ where: wherePond });
		await client.feedingEvent.deleteMany({ where: whereDevicePond });
		await client.energyDevice.deleteMany({ where: wherePond });
		await client.device.deleteMany({ where: wherePond });
		await client.pond.deleteMany({ where: { id: { in: pondIds } } });
	}

	await client.farm.deleteMany({ where: { ownerId: farmId } });
	await client.user.delete({ where: { id: userId } });
}
