import { resolveOrgScope } from "@/lib/auth/org-scope";
import { getCurrentPondOwnerIdSafe, getCurrentUser } from "@/lib/auth/session";
import { MACHINE_FEED_SOURCES } from "@/lib/feed-figures";
import { type FeederStatus, feederStatus } from "@/lib/feeder/feeder-parts";
import prisma from "@/lib/prisma";

/**
 * One guarded read for the device detail / 3D viewer (plan v1.1.0).
 *
 * Tenant admins see every pond in their organization; every other member sees
 * the active ponds they own (view-as resolves to the target farm through
 * `getCurrentPondOwnerIdSafe`). A device outside that scope returns null, and
 * the page turns that into notFound() — unknown and out-of-scope are the same
 * answer.
 */
export interface FeederDeviceDetail {
	id: string;
	label: string;
	mac: string;
	lastSeenAt: Date | null;
	rtcOk: boolean;
	isPaused: boolean;
	feedLevelPercent: number | null;
	hopperCapacityG: number | null;
	gramsPerFeeding: number;
	pond: { id: string; name: string };
	lastFedAt: Date | null;
	lastFedGrams: number | null;
	status: FeederStatus;
}

export async function getDeviceDetail(
	deviceId: string,
	now: Date = new Date(),
): Promise<FeederDeviceDetail | null> {
	const user = await getCurrentUser();
	if (!user) return null;

	let pondIds: string[];
	const orgPondIds = (await resolveOrgScope()).pondIds;
	if (orgPondIds.length > 0) {
		pondIds = orgPondIds;
	} else {
		const ownerId = await getCurrentPondOwnerIdSafe();
		if (!ownerId) return null;
		const ponds = await prisma.pond.findMany({
			where: { ownerId, status: "ACTIVE" },
			select: { id: true },
			take: 200,
		});
		pondIds = ponds.map((pond) => pond.id);
	}
	if (pondIds.length === 0) return null;

	const device = await prisma.energyDevice.findFirst({
		where: { id: deviceId, pondId: { in: pondIds } },
		select: {
			id: true,
			label: true,
			mac: true,
			lastSeenAt: true,
			rtcOk: true,
			isPaused: true,
			feedLevelPercent: true,
			hopperCapacityG: true,
			gramsPerFeeding: true,
			pond: { select: { id: true, name: true } },
		},
	});
	if (!device?.pond) return null;

	const latestFeed = await prisma.feedEvent.findFirst({
		where: {
			deviceId: device.id,
			eventType: "feed_dispensed",
			source: { in: [...MACHINE_FEED_SOURCES] },
		},
		orderBy: { receivedAt: "desc" },
		select: { receivedAt: true, grams: true },
	});

	return {
		...device,
		pond: device.pond,
		lastFedAt: latestFeed?.receivedAt ?? null,
		lastFedGrams: latestFeed?.grams ?? null,
		status: feederStatus({
			isPaused: device.isPaused,
			lastSeenAt: device.lastSeenAt,
			lastFedAt: latestFeed?.receivedAt ?? null,
			now,
		}),
	};
}
